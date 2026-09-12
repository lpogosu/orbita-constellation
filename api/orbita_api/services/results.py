"""Результат завершённого запуска: контекст, снимок отсчёта, шкала времени и выгрузка.

Результат живёт в трёх местах сразу. Агрегаты — метрики, перерывы и их доказательства —
лежат в Postgres и читаются запросом. Трасса и выгрузка лежат в хранилище артефактов
(ADR-010). Координаты аппаратов не хранятся нигде: они детерминированно восстанавливаются
из сценария и времени.

Поэтому у всех «тяжёлых» endpoint один общий вход — `RunContext`: сценарий запуска,
contact plan и маршруты клиентов по отсчётам. Он собирается из артефактов, а если их уже
нет — повторным расчётом с новым сохранением (`06_STORAGE.md` §6). Сборка стоит десятки
миллисекунд и идёт в отдельном потоке, поэтому последние контексты держатся в памяти
процесса: перетаскивание ползунка времени не должно распаковывать трассу на каждый кадр.

Причины отсутствия маршрута берутся из `orbita_core.diagnosis.triggered_causes`, а не из
`diagnose`: перекрёстная проверка диагноза с таблицей маршрутов уже выполнена расчётом,
результат которого мы читаем, и повторять её на каждом снимке значило бы пересобирать
`RouteTable` со всеми её производными ради проверки, которая ничего нового не даст.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from collections import OrderedDict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

import numpy as np
from numpy.typing import NDArray
from orbita_core import contacts, engine
from orbita_core.contacts import ContactPlan
from orbita_core.diagnosis import OutageCause as CoreOutageCause
from orbita_core.diagnosis import TickView, build_tick_view, triggered_causes
from orbita_core.export import LoadedExport, loads_export
from orbita_core.routing import RoutingPolicy as CoreRoutingPolicy
from orbita_core.routing import disjoint_paths
from orbita_core.scenario import Scenario as CoreScenario
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageBundle, StorageRegistry
from orbita_api.adapters.storage import ArtifactKind, artifact_key
from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError, InvalidRequestError
from orbita_api.repositories import MetricsRepository, RunRepository, VariantRepository
from orbita_api.schemas.common import EdgeKind, OutageCause, RoutingPolicy, RunStatus
from orbita_api.schemas.errors import ErrorCode, ErrorDetail
from orbita_api.schemas.results import ClientMetrics, ConfigMetrics, OutageInterval, RunMetrics
from orbita_api.schemas.runs import (
    BackupPaths,
    ClientRoute,
    ClientTimeline,
    RunTimeline,
    Snapshot,
    SnapshotEdge,
    SnapshotSatellite,
)
from orbita_api.services import artifacts, scenarios, trace_codec
from orbita_api.services.trace_codec import TraceFormatError

logger = logging.getLogger(__name__)

RUN_ENTITY: Final[str] = "Запуск"
VARIANT_ENTITY: Final[str] = "Вариант"
CLIENT_ENTITY: Final[str] = "Клиентский пункт"

# Сколько разобранных запусков держать в памяти процесса. Контекст суточного расчёта — это
# десяток мегабайт массивов, поэтому кэш ограничен: нужен он одному пользователю, который
# ходит по отсчётам одного и того же запуска.
CONTEXT_CACHE_SIZE: Final[int] = 8

# Маршрут одного клиента на каждом отсчёте горизонта; `None` — маршрута нет.
ClientPaths = dict[str, list[list[str] | None]]


@dataclass(frozen=True, slots=True, eq=False)
class RunContext:
    """Всё, что нужно, чтобы ответить на любой запрос о результате запуска.

    Сравнение по значению отключено: `plan` держит массивы NumPy.
    """

    run_id: UUID
    scenario: CoreScenario
    plan: ContactPlan
    paths: ClientPaths
    policy: RoutingPolicy
    export_text: str

    @property
    def step_s(self) -> int:
        return self.plan.step_s

    @property
    def ticks(self) -> int:
        return self.plan.ticks


_CACHE: Final[OrderedDict[UUID, RunContext]] = OrderedDict()


def _cached(run_id: UUID) -> RunContext | None:
    context = _CACHE.get(run_id)
    if context is not None:
        _CACHE.move_to_end(run_id)
    return context


def _remember(context: RunContext) -> None:
    _CACHE[context.run_id] = context
    _CACHE.move_to_end(context.run_id)
    while len(_CACHE) > CONTEXT_CACHE_SIZE:
        _CACHE.popitem(last=False)


def _failed_stage(run: models.Run) -> str:
    """Стадия, на которой упал расчёт: из записанной ошибки, иначе из самой строки."""
    error = run.error or {}
    details = error.get("details") or {}
    stage = details.get("stage") if isinstance(details, dict) else None
    return str(stage) if stage is not None else str(run.stage)


async def require_finished_run(session: AsyncSession, run_id: UUID) -> models.Run:
    """Запуск, у которого есть результат. Иначе 404 или 400 с причиной."""
    run = await RunRepository(session).get(run_id)
    if run is None:
        raise EntityNotFoundError(RUN_ENTITY, run_id)
    if run.status is RunStatus.SUCCEEDED:
        return run
    if run.status is RunStatus.FAILED:
        raise InvalidRequestError(
            ErrorDetail(
                code=ErrorCode.RUN_FAILED,
                message="Расчёт завершился ошибкой, результата нет",
                details={"id": str(run_id), "stage": _failed_stage(run)},
            ),
        )
    raise InvalidRequestError(
        ErrorDetail(
            code=ErrorCode.RUN_NOT_READY,
            message="Расчёт ещё не завершён",
            details={"id": str(run_id), "status": str(run.status)},
        ),
    )


def tick_of(t_s: int, step_s: int, horizon_s: int) -> int:
    """Номер отсчёта по времени в секундах.

    Сетка дискретна, и промежуточного состояния между отсчётами не существует: запрос
    времени не из сетки — ошибка входа, а не повод округлить (`05_API.md` §3).
    """
    if t_s % step_s != 0 or t_s >= horizon_s:
        raise InvalidRequestError(
            ErrorDetail(
                code=ErrorCode.INVALID_SCENARIO_FIELD,
                message=(
                    f"Отсчёт должен быть кратен шагу {step_s} с и лежать в "
                    f"[0; {horizon_s}) с"
                ),
                path="t_s",
                details={"value": t_s, "step_s": step_s, "horizon_s": horizon_s},
            ),
        )
    return t_s // step_s


def require_client(scenario: CoreScenario, client_id: str) -> str:
    """Клиентский пункт сценария; чужой идентификатор — 404 с указанием параметра."""
    if client_id not in scenario.client_ids:
        raise EntityNotFoundError(CLIENT_ENTITY, client_id, path="client_id")
    return client_id


async def _read_artifact(
    bundle: StorageBundle,
    storage: StorageRegistry,
    key: str,
) -> bytes | None:
    """Объект из внешнего хранилища, при его отказе — из локального каталога.

    Отсутствие объекта не ошибка: срок хранения трассы истекает раньше, чем срок жизни
    запуска, и результат в этом случае пересчитывается (`06_STORAGE.md` §6).
    """
    for store in (bundle.artifacts, storage.local_artifacts):
        try:
            return await store.get(key)
        except Exception:
            continue
    return None


def _paths_from_export(loaded: LoadedExport) -> ClientPaths:
    """Маршруты по клиентам и отсчётам из записей `routes` выгрузки.

    Полнота записей уже проверена разбором выгрузки: ровно одна запись на пару
    «отсчёт — клиент» (инвариант 9 `10_FIXTURES.md` §2).
    """
    scenario = loaded.scenario
    step_s = scenario.environment.step_s
    paths: ClientPaths = {
        client: [None] * scenario.ticks for client in scenario.client_ids
    }
    for record in loaded.routes:
        paths[record.client_id][record.t_s // step_s] = list(record.path) or None
    return paths


def _context_from_artifacts(
    run_id: UUID,
    policy: RoutingPolicy,
    document: bytes,
    trace: bytes | None,
) -> RunContext:
    """Контекст из сохранённых выгрузки и трассы.

    Сценарий берётся из самой выгрузки: именно он использован в расчёте, и именно по нему
    восстанавливается геометрия. Трасса даёт состояние линий связи таким, каким его видел
    расчёт; без неё contact plan пересобирается по сценарию — результат тот же, но на
    десятки миллисекунд дороже.
    """
    text = document.decode("utf-8")
    loaded = loads_export(text)
    plan: ContactPlan | None = None
    if trace is not None:
        try:
            plan = trace_codec.restore_plan(trace_codec.decode_trace(trace), loaded.scenario)
        except TraceFormatError as error:
            logger.warning(
                "Трасса запуска %s не прочитана, план собирается заново: %s", run_id, error
            )
    if plan is None:
        plan = contacts.build(loaded.scenario)
    return RunContext(
        run_id=run_id,
        scenario=loaded.scenario,
        plan=plan,
        paths=_paths_from_export(loaded),
        policy=policy,
        export_text=text,
    )


async def _recalculated(
    session: AsyncSession,
    storage: StorageRegistry,
    run: models.Run,
    scenario: CoreScenario,
    policy: RoutingPolicy,
) -> RunContext:
    """Повторный расчёт запуска, артефакты которого уже удалены по сроку хранения.

    Расчёт детерминирован при том же сценарии и той же версии ядра (ADR-011), поэтому
    результат совпадает с исходным; артефакты сохраняются заново, чтобы следующий запрос
    снова читал их, а не считал сутки.
    """
    logger.info("Артефакты запуска %s недоступны, результат пересчитывается", run.id)
    result = await asyncio.to_thread(engine.run, scenario, CoreRoutingPolicy(str(policy)))
    text = await asyncio.to_thread(artifacts.export_document, result, run.id)
    report = await artifacts.persist_run_artifacts(
        session,
        run.id,
        result.plan,
        text.encode("utf-8"),
        storage,
    )
    # Признак описывает, где лежат артефакты запуска, поэтому он обновляется вместе с ними.
    run.degraded_mode = report.degraded_mode
    await session.commit()
    return RunContext(
        run_id=run.id,
        scenario=result.scenario,
        plan=result.plan,
        paths={client: list(result.routes.paths[client]) for client in result.routes.clients},
        policy=policy,
        export_text=text,
    )


async def load_context(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
) -> RunContext:
    """Контекст завершённого запуска, из кэша процесса либо из хранилища."""
    cached = _cached(run_id)
    if cached is not None:
        return cached

    run = await require_finished_run(session, run_id)
    policy = RoutingPolicy(str(run.routing_policy))
    bundle = await storage.resolve()
    document = await _read_artifact(bundle, storage, artifact_key(run_id, ArtifactKind.EXPORT))
    if document is None:
        variant = await VariantRepository(session).get(run.variant_id)
        if variant is None:
            raise EntityNotFoundError(VARIANT_ENTITY, run.variant_id)
        context = await _recalculated(
            session,
            storage,
            run,
            scenarios.parse_stored(variant.scenario),
            policy,
        )
    else:
        trace = await _read_artifact(bundle, storage, artifact_key(run_id, ArtifactKind.TRACE))
        context = await asyncio.to_thread(
            _context_from_artifacts,
            run_id,
            policy,
            document,
            trace,
        )
    _remember(context)
    return context


def _client_route(
    client_id: str,
    path: list[str] | None,
    causes: Sequence[CoreOutageCause],
) -> ClientRoute:
    if path is not None:
        # Переход — ребро маршрута, включая обе наземные линии (`03_GLOSSARY.md` §1).
        return ClientRoute(client_id=client_id, reachable=True, path=path, hops=len(path) - 1)
    # Маршрута нет, но ни одна причина не сработала: расчёт разошёлся с самим собой, и у
    # этого состояния есть собственное имя в `03_GLOSSARY.md` §3.1.
    resolved = tuple(causes) or (CoreOutageCause.INTERNAL_INCONSISTENCY,)
    return ClientRoute(
        client_id=client_id,
        reachable=False,
        path=[],
        hops=None,
        primary_cause=OutageCause(str(resolved[0])),
        causes=[OutageCause(str(cause)) for cause in resolved],
    )


def build_snapshot(
    scenario: CoreScenario,
    plan: ContactPlan,
    tick: int,
    paths: Mapping[str, list[str] | None],
) -> Snapshot:
    """Состояние сети на одном отсчёте: аппараты, линии связи и маршруты клиентов.

    Состояние отсчёта для диагностики строится один раз на всех клиентов: компоненты
    связности — самая дорогая её часть, а зависят они только от отсчёта.
    """
    t_s = tick * plan.step_s
    failed = {item.node_id for item in scenario.failures if item.covers(t_s)}
    positions = plan.positions[tick]
    satellites = [
        SnapshotSatellite(
            id=satellite.id,
            plane_id=satellite.plane_id,
            x_km=float(positions[index, 0]),
            y_km=float(positions[index, 1]),
            z_km=float(positions[index, 2]),
            active=bool(plan.active[tick, index]),
            failed=satellite.id in failed,
        )
        for index, satellite in enumerate(scenario.satellites)
    ]
    edges = [
        SnapshotEdge(
            a=plan.nodes[int(plan.edges[edge, 0])],
            b=plan.nodes[int(plan.edges[edge, 1])],
            distance_km=float(plan.dist[tick, edge]),
            kind=EdgeKind(str(plan.kinds[edge])),
        )
        for edge in plan.edges_at(tick).tolist()
    ]

    unreachable = [client for client, path in paths.items() if path is None]
    causes_of: dict[str, tuple[CoreOutageCause, ...]] = {}
    if unreachable:
        view = build_tick_view(plan, tick)
        causes_of = {client: triggered_causes(view, client) for client in unreachable}

    clients = [
        _client_route(client, paths[client], causes_of.get(client, ()))
        for client in scenario.client_ids
    ]
    return Snapshot(t_s=t_s, satellites=satellites, edges=edges, clients=clients)


def _visibility(plan: ContactPlan, client_id: str) -> NDArray[np.bool_]:
    """Отсчёты, на которых клиенту виден хотя бы один активный аппарат.

    Наземное ребро существует только при выполненном условии по углу возвышения и
    активности аппарата, поэтому видимость читается прямо из битовой матрицы плана.
    """
    node = plan.node_index[client_id]
    columns = np.flatnonzero(plan.edges[:, 1] == node)
    if columns.size == 0:
        return np.zeros(plan.ticks, dtype=np.bool_)
    return np.asarray(plan.bits[:, columns].any(axis=1), dtype=np.bool_)


def _bitset(mask: NDArray[np.bool_]) -> str:
    """Битовая маска отсчётов в base64: 720 отметок — это 90 байт вместо 720."""
    return base64.b64encode(np.packbits(mask).tobytes()).decode("ascii")


def _primary_cause(view: TickView, client_id: str) -> OutageCause:
    causes = triggered_causes(view, client_id)
    resolved = causes[0] if causes else CoreOutageCause.INTERNAL_INCONSISTENCY
    return OutageCause(str(resolved))


def build_timeline(context: RunContext) -> RunTimeline:
    """Шкала доступности и причин по всем клиентам за один запрос.

    Состояние отсчёта строится один раз на всех клиентов, у которых на нём нет маршрута:
    перерывы клиентов чаще всего приходятся на одни и те же отсчёты.
    """
    without_path = sorted(
        {
            tick
            for paths in context.paths.values()
            for tick, path in enumerate(paths)
            if path is None
        },
    )
    views = {tick: build_tick_view(context.plan, tick) for tick in without_path}
    clients = [
        ClientTimeline(
            client_id=client,
            availability_bitset=_bitset(
                np.array([path is not None for path in context.paths[client]], dtype=np.bool_),
            ),
            visibility_bitset=_bitset(_visibility(context.plan, client)),
            causes=[
                None if path is not None else _primary_cause(views[tick], client)
                for tick, path in enumerate(context.paths[client])
            ],
        )
        for client in context.scenario.client_ids
    ]
    return RunTimeline(
        run_id=context.run_id,
        total_ticks=context.ticks,
        step_s=context.step_s,
        clients=clients,
    )


def build_backup_paths(context: RunContext, tick: int, client_id: str) -> BackupPaths:
    """Вершинно-непересекающиеся маршруты клиента и минимальный разрез (ADR-007)."""
    count, paths, min_cut = disjoint_paths(context.plan, tick, client_id)
    return BackupPaths(
        run_id=context.run_id,
        t_s=tick * context.step_s,
        client_id=client_id,
        backup_path_count=count,
        paths=paths,
        min_cut_satellites=list(min_cut),
    )


def _counts_by_cause(stored: dict[str, Any]) -> dict[OutageCause, int]:
    """Счётчики причин из JSONB: ключи в базе — строки глоссария, в контракте — enum."""
    return {OutageCause(cause): int(count) for cause, count in stored.items()}


def to_client_metrics(row: models.ClientMetrics) -> ClientMetrics:
    return ClientMetrics(
        client_id=row.client_id,
        availability=row.availability,
        visibility=row.visibility,
        max_gap_s=row.max_gap_s,
        mean_hops=row.mean_hops,
        max_hops=row.max_hops,
        route_switches=row.route_switches,
        target_met=row.target_met,
        outage_count_by_cause=_counts_by_cause(row.outage_count_by_cause),
    )


def to_config_metrics(row: models.ConfigMetrics) -> ConfigMetrics:
    return ConfigMetrics(
        min_client_availability=row.min_client_availability,
        mean_client_availability=row.mean_client_availability,
        worst_max_gap_s=row.worst_max_gap_s,
        mean_hops=row.mean_hops,
        max_hops=row.max_hops,
        route_switches_total=row.route_switches_total,
        backup_path_count_min=row.backup_path_count_min,
        outage_count_by_cause=_counts_by_cause(row.outage_count_by_cause),
        target_met_clients=list(row.target_met_clients),
    )


def _to_outage(row: models.OutageInterval) -> OutageInterval:
    evidence: dict[str, Any] = dict(row.evidence)
    return OutageInterval(
        client_id=row.client_id,
        start_s=row.start_s,
        end_s=row.end_s,
        duration_s=row.end_s - row.start_s,
        truncated_by_horizon=row.truncated_by_horizon,
        primary_cause=row.primary_cause,
        causes=[OutageCause(str(cause)) for cause in row.causes],
        client_visible_satellites=list(evidence["client_visible_satellites"]),
        gateway_visible_satellites=list(evidence["gateway_visible_satellites"]),
        failed_satellites=list(evidence["failed_satellites"]),
        client_component_id=evidence["client_component_id"],
        gateway_component_id=evidence["gateway_component_id"],
        last_path=list(evidence["last_path"]),
        next_path=list(evidence["next_path"]),
    )


async def run_metrics(session: AsyncSession, run_id: UUID) -> RunMetrics:
    """Метрики клиентов и конфигурации из Postgres: пересчёт для них не нужен."""
    await require_finished_run(session, run_id)
    repository = MetricsRepository(session)
    config = await repository.config_of(run_id)
    if config is None:
        raise InvalidRequestError(
            ErrorDetail(
                code=ErrorCode.RUN_NOT_READY,
                message="Метрики запуска ещё не записаны",
                details={"id": str(run_id)},
            ),
        )
    clients = await repository.clients_of(run_id)
    return RunMetrics(
        run_id=run_id,
        clients=[to_client_metrics(row) for row in clients],
        config=to_config_metrics(config),
    )


async def run_outages(session: AsyncSession, run_id: UUID) -> list[OutageInterval]:
    await require_finished_run(session, run_id)
    rows = await MetricsRepository(session).outages_of(run_id)
    return [_to_outage(row) for row in rows]


async def run_snapshot(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
    t_s: int,
) -> Snapshot:
    context = await load_context(session, storage, run_id)
    tick = tick_of(t_s, context.step_s, context.scenario.environment.horizon_s)
    return await asyncio.to_thread(
        build_snapshot,
        context.scenario,
        context.plan,
        tick,
        {client: paths[tick] for client, paths in context.paths.items()},
    )


async def run_timeline(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
) -> RunTimeline:
    context = await load_context(session, storage, run_id)
    return await asyncio.to_thread(build_timeline, context)


async def run_backup_paths(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
    t_s: int,
    client_id: str,
) -> BackupPaths:
    context = await load_context(session, storage, run_id)
    tick = tick_of(t_s, context.step_s, context.scenario.environment.horizon_s)
    require_client(context.scenario, client_id)
    return await asyncio.to_thread(build_backup_paths, context, tick, client_id)


async def run_export(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
) -> str:
    """Текст файла выгрузки: ровно тот, что лежит артефактом запуска."""
    context = await load_context(session, storage, run_id)
    return context.export_text
