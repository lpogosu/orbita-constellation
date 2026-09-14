"""Сравнение запусков и рекомендация по конфигурации (ADR-006, ADR-012).

Метрики, дельты и рекомендация собираются из того, что уже записано в Postgres, и из diff
канонических сценариев вариантов: ни расчёта, ни генерации текста здесь нет. Порядок
предпочтения и границы применимости даёт ядро (`orbita_core.ranking`), разбор перерывов —
`orbita_core.compare`; этот слой только переводит строки таблиц в датаклассы ядра и
обратно в контракт.

Разбор перерывов дополнительно поднимает маршруты обоих запусков из их выгрузок
(`RunContext`): в метриках маршрутов нет, а вопрос «где путь уцелел, а где был
перестроен» без них не отвечается. Пересчёта это не требует — маршруты уже лежат в
артефакте запуска.

Сравнивать между собой можно лишь расчёты одной задачи: разные сетка времени, дальность
ISL или угол возвышения означают разные задачи, и дельта между ними ничего не измеряет
(`01_SPEC.md` §7).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from orbita_core import ranking
from orbita_core.compare import ClientComparison as CoreClientComparison
from orbita_core.compare import OutageChange as CoreOutageChange
from orbita_core.compare import compare_client
from orbita_core.diagnosis import OutageCause as CoreOutageCause
from orbita_core.metrics import ClientMetrics as CoreClientMetrics
from orbita_core.metrics import ConfigMetrics as CoreConfigMetrics
from orbita_core.metrics import OutageInterval as CoreOutageInterval
from orbita_core.ranking import Candidate, RunConditions
from orbita_core.scenario import Scenario as CoreScenario
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry
from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError, InvalidRequestError
from orbita_api.repositories import (
    MetricsRepository,
    RecommendationRepository,
    RunRepository,
    VariantRepository,
)
from orbita_api.schemas.common import (
    OutageCause,
    OutageChangeKind,
    ParameterChange,
    RoutingPolicy,
)
from orbita_api.schemas.errors import ErrorCode, ErrorDetail
from orbita_api.schemas.results import (
    ClientComparison,
    ClientDelta,
    ComparisonEntry,
    ComparisonResult,
    OutageChange,
    Recommendation,
)
from orbita_api.services import diff, results, scenarios
from orbita_api.services.results import ClientPaths

VARIANT_ENTITY: Final[str] = "Вариант"

# Поле сценария, которым описывается расхождение сеток: шаг задаёт саму сетку, и разговор
# о разных горизонтах при разном шаге бессмыслен.
GRID_PATH: Final[str] = "environment.step_s"


@dataclass(frozen=True, slots=True)
class RunSummary:
    """Запуск вместе со своим вариантом и записанными метриками."""

    run: models.Run
    variant: models.Variant
    scenario: CoreScenario
    config: models.ConfigMetrics
    clients: Sequence[models.ClientMetrics]

    @property
    def conditions(self) -> RunConditions:
        return RunConditions.from_environment(self.scenario.environment)


async def summary(session: AsyncSession, run_id: UUID) -> RunSummary:
    """Всё, что нужно для сравнения одного запуска. Незавершённый — 400, чужой — 404."""
    run = await results.require_finished_run(session, run_id)
    variant = await VariantRepository(session).get(run.variant_id)
    if variant is None:
        raise EntityNotFoundError(VARIANT_ENTITY, run.variant_id)
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
    return RunSummary(
        run=run,
        variant=variant,
        scenario=scenarios.parse_stored(variant.scenario),
        config=config,
        clients=await repository.clients_of(run_id),
    )


@dataclass(frozen=True, slots=True, eq=False)
class RunHistory:
    """Поведение запуска во времени: маршруты по отсчётам и перерывы по клиентам.

    Метрики отвечают, насколько стало хуже, но не отвечают, где именно: для этого нужны
    сами маршруты. Сравнение по значению отключено, потому что маршруты — это списки на
    весь горизонт, а сравнивать историю целиком незачем.
    """

    paths: ClientPaths
    outages: dict[str, list[CoreOutageInterval]]
    step_s: int

    def client_outages(self, client_id: str) -> list[CoreOutageInterval]:
        """Перерывы клиента; пустой список означает связь без единого разрыва."""
        return self.outages.get(client_id, [])


def _core_outage(row: models.OutageInterval) -> CoreOutageInterval:
    """Строка таблицы перерывов как датакласс ядра: сравнение работает на типах ядра."""
    evidence: dict[str, Any] = dict(row.evidence)
    return CoreOutageInterval(
        client_id=row.client_id,
        start_s=row.start_s,
        end_s=row.end_s,
        duration_s=row.end_s - row.start_s,
        truncated_by_horizon=row.truncated_by_horizon,
        primary_cause=CoreOutageCause(str(row.primary_cause)),
        causes=tuple(CoreOutageCause(str(cause)) for cause in row.causes),
        client_visible_satellites=tuple(evidence["client_visible_satellites"]),
        gateway_visible_satellites=tuple(evidence["gateway_visible_satellites"]),
        failed_satellites=tuple(evidence["failed_satellites"]),
        client_component_id=evidence["client_component_id"],
        gateway_component_id=evidence["gateway_component_id"],
        last_path=tuple(evidence["last_path"]) or None,
        next_path=tuple(evidence["next_path"]) or None,
    )


async def history(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
) -> RunHistory:
    """Маршруты и перерывы завершённого запуска.

    Маршруты берутся из контекста запуска — то есть из сохранённой выгрузки, а не из
    нового расчёта: результат уже посчитан, и повторять сутки ради сравнения незачем.
    """
    context = await results.load_context(session, storage, run_id)
    grouped: dict[str, list[CoreOutageInterval]] = defaultdict(list)
    for row in await MetricsRepository(session).outages_of(run_id):
        grouped[row.client_id].append(_core_outage(row))
    return RunHistory(paths=context.paths, outages=dict(grouped), step_s=context.step_s)


def _require_same_grid(base: RunSummary, other: RunSummary) -> None:
    base_environment = base.scenario.environment
    other_environment = other.scenario.environment
    if (base_environment.step_s, base_environment.horizon_s) == (
        other_environment.step_s,
        other_environment.horizon_s,
    ):
        return
    raise InvalidRequestError(
        ErrorDetail(
            code=ErrorCode.INVALID_SCENARIO_FIELD,
            message="Запуски посчитаны на разных сетках времени и несравнимы",
            path=GRID_PATH,
            details={
                "base_run_id": str(base.run.id),
                "run_id": str(other.run.id),
                "base": {
                    "step_s": base_environment.step_s,
                    "horizon_s": base_environment.horizon_s,
                },
                "other": {
                    "step_s": other_environment.step_s,
                    "horizon_s": other_environment.horizon_s,
                },
            },
        ),
    )


def _changed_parameters(base: RunSummary, other: RunSummary) -> list[ParameterChange]:
    """Чем сценарий кандидата отличается от базового.

    Сравниваются канонические сценарии вариантов, а не их diff от собственных родителей:
    варианты могут лежать в разных ветвях происхождения, и цепочка правок между ними не
    отвечает на вопрос «что именно отличается сейчас».
    """
    return diff.scenario_diff(base.variant.scenario, other.variant.scenario)


def _config_deltas(base: models.ConfigMetrics, other: models.ConfigMetrics) -> dict[str, float]:
    """Изменение метрик конфигурации относительно базового запуска.

    Метрика без значения хотя бы у одной стороны пропускается: разность с отсутствующим
    числом переходов означала бы, что сравнивать нечего.
    """
    deltas: dict[str, float] = {
        "min_client_availability": other.min_client_availability - base.min_client_availability,
        "worst_max_gap_s": float(other.worst_max_gap_s - base.worst_max_gap_s),
        "mean_client_availability": (
            other.mean_client_availability - base.mean_client_availability
        ),
        "route_switches_total": float(other.route_switches_total - base.route_switches_total),
    }
    if base.backup_path_count_min is not None and other.backup_path_count_min is not None:
        deltas["backup_path_count_min"] = float(
            other.backup_path_count_min - base.backup_path_count_min,
        )
    if base.mean_hops is not None and other.mean_hops is not None:
        deltas["mean_hops"] = other.mean_hops - base.mean_hops
    return deltas


def _outage_change(change: CoreOutageChange) -> OutageChange:
    return OutageChange(
        kind=OutageChangeKind(str(change.kind)),
        base_start_s=change.base_start_s,
        base_end_s=change.base_end_s,
        other_start_s=change.other_start_s,
        other_end_s=change.other_end_s,
        primary_cause=OutageCause(str(change.primary_cause)),
        causes=[OutageCause(str(cause)) for cause in change.causes],
        failed_satellites=list(change.failed_satellites),
    )


def _client_comparison(
    base_row: models.ClientMetrics,
    other_row: models.ClientMetrics,
    comparison: CoreClientComparison,
) -> ClientComparison:
    return ClientComparison(
        client_id=base_row.client_id,
        availability_delta=other_row.availability - base_row.availability,
        max_gap_delta_s=other_row.max_gap_s - base_row.max_gap_s,
        outage_diff=[_outage_change(change) for change in comparison.outage_diff],
        affected=comparison.affected,
        route_kept_ticks=comparison.route_kept_ticks,
        route_rebuilt_ticks=comparison.route_rebuilt_ticks,
        first_divergence_t_s=comparison.first_divergence_t_s,
        first_new_outage_t_s=comparison.first_new_outage_t_s,
    )


def _client_deltas(
    base: RunSummary,
    other: RunSummary,
    base_history: RunHistory,
    other_history: RunHistory,
) -> list[ClientComparison]:
    """Дельты и разбор перерывов по клиентам в порядке базового запуска.

    Считаются только для пунктов, которые есть в обоих сценариях: у появившегося или
    исчезнувшего пункта нет второй половины разности.
    """
    other_clients = {row.client_id: row for row in other.clients}
    entries: list[ClientComparison] = []
    for row in base.clients:
        other_row = other_clients.get(row.client_id)
        if other_row is None:
            continue
        comparison = compare_client(
            row.client_id,
            base_paths=base_history.paths[row.client_id],
            other_paths=other_history.paths[row.client_id],
            base_outages=base_history.client_outages(row.client_id),
            other_outages=other_history.client_outages(row.client_id),
            step_s=base_history.step_s,
        )
        entries.append(_client_comparison(row, other_row, comparison))
    return entries


def _first_divergence(per_client: Sequence[ClientComparison]) -> int | None:
    """Самый ранний отсчёт расхождения по всем клиентам: с него начинается разбор."""
    moments = [
        item.first_divergence_t_s for item in per_client if item.first_divergence_t_s is not None
    ]
    return min(moments) if moments else None


def _entry(
    base: RunSummary,
    item: RunSummary,
    histories: dict[UUID, RunHistory],
) -> ComparisonEntry:
    is_base = item.run.id == base.run.id
    per_client = (
        []
        if is_base
        else _client_deltas(base, item, histories[base.run.id], histories[item.run.id])
    )
    return ComparisonEntry(
        run_id=item.run.id,
        variant_id=item.variant.id,
        variant_title=item.variant.title,
        routing_policy=RoutingPolicy(str(item.run.routing_policy)),
        config=results.to_config_metrics(item.config),
        clients=[results.to_client_metrics(row) for row in item.clients],
        changed_parameters=[] if is_base else _changed_parameters(base, item),
        deltas={} if is_base else _config_deltas(base.config, item.config),
        per_client=per_client,
        affected_clients=[entry.client_id for entry in per_client if entry.affected],
        first_divergence_t_s=_first_divergence(per_client),
    )


async def compare(
    session: AsyncSession,
    storage: StorageRegistry,
    run_ids: Sequence[UUID],
) -> ComparisonResult:
    """Метрики запусков рядом с дельтами и разбором перерывов относительно первого."""
    summaries = [await summary(session, run_id) for run_id in run_ids]
    base = summaries[0]
    for item in summaries[1:]:
        _require_same_grid(base, item)
    # История поднимается после проверки сетки: запускам на разных сетках сравнение
    # откажет, и разбирать их маршруты было бы работой впустую.
    histories = {
        item.run.id: await history(session, storage, item.run.id)
        for item in {item.run.id: item for item in summaries}.values()
    }
    return ComparisonResult(
        base_run_id=base.run.id,
        entries=[_entry(base, item, histories) for item in summaries],
    )


def candidate_pool(
    base: RunSummary,
    requested: RunSummary,
    others: Sequence[RunSummary],
) -> list[RunSummary]:
    """Набор, среди которого ищется лучшая конфигурация; первым идёт базовый запуск.

    Запуск на других условиях расчёта в набор не попадает: его метрики получены для
    другой задачи, и ранжировать их рядом значило бы сравнивать несравнимое
    (`01_SPEC.md` §7).
    """
    pool = [base] if requested.run.id == base.run.id else [base, requested]
    seen = {item.run.id for item in pool}
    for item in others:
        if item.run.id in seen or item.conditions != base.conditions:
            continue
        seen.add(item.run.id)
        pool.append(item)
    return pool


def _core_client_metrics(row: models.ClientMetrics) -> CoreClientMetrics:
    return CoreClientMetrics(
        client_id=row.client_id,
        availability=row.availability,
        visibility=row.visibility,
        max_gap_s=row.max_gap_s,
        mean_hops=row.mean_hops,
        max_hops=row.max_hops,
        route_switches=row.route_switches,
        target_met=row.target_met,
        outage_count_by_cause={
            CoreOutageCause(cause): int(count)
            for cause, count in row.outage_count_by_cause.items()
        },
    )


def _core_config_metrics(row: models.ConfigMetrics) -> CoreConfigMetrics:
    return CoreConfigMetrics(
        min_client_availability=row.min_client_availability,
        mean_client_availability=row.mean_client_availability,
        worst_max_gap_s=row.worst_max_gap_s,
        mean_hops=row.mean_hops,
        max_hops=row.max_hops,
        route_switches_total=row.route_switches_total,
        backup_path_count_min=row.backup_path_count_min,
        outage_count_by_cause={
            CoreOutageCause(cause): int(count)
            for cause, count in row.outage_count_by_cause.items()
        },
        target_met_clients=tuple(row.target_met_clients),
    )


def _candidate(base: RunSummary, item: RunSummary) -> Candidate:
    changes = [] if item.run.id == base.run.id else _changed_parameters(base, item)
    return Candidate(
        id=str(item.run.id),
        config=_core_config_metrics(item.config),
        clients=tuple(_core_client_metrics(row) for row in item.clients),
        conditions=item.conditions,
        changed_parameters=tuple(change.model_dump(by_alias=True) for change in changes),
    )


def _to_recommendation(source: ranking.Recommendation) -> Recommendation:
    return Recommendation(
        base_run_id=UUID(source.base_run_id),
        recommended_run_id=UUID(source.recommended_run_id),
        ranking_order=list(source.ranking_order),
        changed_parameters=[
            ParameterChange.model_validate(change) for change in source.changed_parameters
        ],
        deltas=dict(source.deltas),
        per_client=[
            ClientDelta(
                client_id=item.client_id,
                availability_delta=item.availability_delta,
                max_gap_delta_s=item.max_gap_delta_s,
            )
            for item in source.per_client
        ],
        target_reached=source.target_reached,
        limitations=list(source.limitations),
    )


async def recommend(
    session: AsyncSession,
    run_id: UUID,
    base_run_id: UUID,
) -> Recommendation:
    """Лучшая конфигурация относительно базовой среди посчитанных запусков проекта.

    Кандидаты — успешные запуски того же проекта с той же политикой маршрутизации:
    политика входит в постановку задачи, и менять её вместе с конфигурацией значило бы
    сравнивать две правки сразу. Запуски на других условиях расчёта из набора исключаются:
    их метрики получены для другой задачи.
    """
    base = await summary(session, base_run_id)
    requested = await summary(session, run_id)
    _require_same_grid(base, requested)

    siblings = await RunRepository(session).list_succeeded_siblings(
        run_id,
        requested.run.routing_policy,
    )
    known = {base.run.id, requested.run.id}
    others = [await summary(session, run.id) for run in siblings if run.id not in known]

    candidates = [_candidate(base, item) for item in candidate_pool(base, requested, others)]
    recommendation = _to_recommendation(ranking.recommend(candidates[0], candidates[1:]))

    payload: dict[str, Any] = recommendation.model_dump(mode="json", by_alias=True)
    await RecommendationRepository(session).replace_for_base(
        base.run.id,
        models.Recommendation(
            base_run_id=recommendation.base_run_id,
            recommended_run_id=recommendation.recommended_run_id,
            payload=payload,
        ),
    )
    await session.commit()
    return recommendation
