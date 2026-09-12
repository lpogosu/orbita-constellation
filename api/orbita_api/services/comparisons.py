"""Сравнение запусков и рекомендация по конфигурации (ADR-006, ADR-012).

Оба ответа собираются из метрик, уже записанных в Postgres, и из diff канонических
сценариев вариантов: ни расчёта, ни генерации текста здесь нет. Порядок предпочтения и
границы применимости даёт ядро (`orbita_core.ranking`), этот слой только переводит строки
таблиц в его датаклассы и обратно в контракт.

Сравнивать между собой можно лишь расчёты одной задачи: разные сетка времени, дальность
ISL или угол возвышения означают разные задачи, и дельта между ними ничего не измеряет
(`01_SPEC.md` §7).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from orbita_core import ranking
from orbita_core.diagnosis import OutageCause as CoreOutageCause
from orbita_core.metrics import ClientMetrics as CoreClientMetrics
from orbita_core.metrics import ConfigMetrics as CoreConfigMetrics
from orbita_core.ranking import Candidate, RunConditions
from orbita_core.scenario import Scenario as CoreScenario
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError, InvalidRequestError
from orbita_api.repositories import (
    MetricsRepository,
    RecommendationRepository,
    RunRepository,
    VariantRepository,
)
from orbita_api.schemas.common import ParameterChange, RoutingPolicy
from orbita_api.schemas.errors import ErrorCode, ErrorDetail
from orbita_api.schemas.results import (
    ClientDelta,
    ComparisonEntry,
    ComparisonResult,
    Recommendation,
)
from orbita_api.services import diff, results, scenarios

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


def _client_deltas(base: RunSummary, other: RunSummary) -> list[ClientDelta]:
    """Дельты по клиентам в порядке базового запуска.

    Считаются только для пунктов, которые есть в обоих сценариях: у появившегося или
    исчезнувшего пункта нет второй половины разности.
    """
    other_clients = {row.client_id: row for row in other.clients}
    return [
        ClientDelta(
            client_id=row.client_id,
            availability_delta=other_clients[row.client_id].availability - row.availability,
            max_gap_delta_s=other_clients[row.client_id].max_gap_s - row.max_gap_s,
        )
        for row in base.clients
        if row.client_id in other_clients
    ]


def _entry(base: RunSummary, item: RunSummary) -> ComparisonEntry:
    is_base = item.run.id == base.run.id
    return ComparisonEntry(
        run_id=item.run.id,
        variant_id=item.variant.id,
        variant_title=item.variant.title,
        routing_policy=RoutingPolicy(str(item.run.routing_policy)),
        config=results.to_config_metrics(item.config),
        clients=[results.to_client_metrics(row) for row in item.clients],
        changed_parameters=[] if is_base else _changed_parameters(base, item),
        deltas={} if is_base else _config_deltas(base.config, item.config),
        per_client=[] if is_base else _client_deltas(base, item),
    )


async def compare(session: AsyncSession, run_ids: Sequence[UUID]) -> ComparisonResult:
    """Метрики запусков рядом с дельтами относительно первого из них."""
    summaries = [await summary(session, run_id) for run_id in run_ids]
    base = summaries[0]
    for item in summaries[1:]:
        _require_same_grid(base, item)
    return ComparisonResult(
        base_run_id=base.run.id,
        entries=[_entry(base, item) for item in summaries],
    )


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
    known = {base.run.id: base, requested.run.id: requested}
    pool = [base, requested]
    for run in siblings:
        if run.id in known:
            continue
        item = await summary(session, run.id)
        if item.conditions != base.conditions:
            continue
        known[run.id] = item
        pool.append(item)

    candidates = [_candidate(base, item) for item in pool]
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
