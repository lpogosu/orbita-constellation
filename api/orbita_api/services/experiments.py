"""Application service for RAAN/phase configuration sweeps."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from orbita_core import ENGINE_VERSION
from orbita_core.sweep import Axis, BudgetExceeded, Point, apply_point, grid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError, InvalidRequestError
from orbita_api.repositories.experiments import ExperimentRepository
from orbita_api.repositories.jobs import JobRepository
from orbita_api.repositories.runs import RunRepository
from orbita_api.repositories.variants import VariantRepository
from orbita_api.runtime import RunRuntime
from orbita_api.schemas.common import RunStage, RunStatus
from orbita_api.schemas.errors import ErrorCode, ErrorDetail
from orbita_api.schemas.experiments import (
    Experiment as ExperimentSchema,
)
from orbita_api.schemas.experiments import (
    ExperimentAxis,
    ExperimentBudget,
    ExperimentCreateRequest,
)
from orbita_api.schemas.experiments import (
    ExperimentPoint as PointSchema,
)
from orbita_api.schemas.projects import Variant as VariantSchema
from orbita_api.services import diff, scenarios, serialization

EXPERIMENT_ENTITY = "Эксперимент"
TERMINAL_STATUSES = frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED})


@dataclass(frozen=True, slots=True)
class PointState:
    """Точка sweep в том виде, в каком её отдаёт API, и статус её запуска.

    Статус запуска в контракт точки не входит, но от него зависят прогресс и итоговый
    статус эксперимента, поэтому он читается один раз вместе с метриками и едет рядом.
    """

    point: PointSchema
    run_status: RunStatus

    @property
    def is_finished(self) -> bool:
        return self.point.run_id is not None and self.run_status in TERMINAL_STATUSES


async def create_experiment(
    session: AsyncSession, runtime: RunRuntime, request: ExperimentCreateRequest
) -> ExperimentSchema:
    base = await VariantRepository(session).get(request.variant_id)
    if base is None:
        raise EntityNotFoundError("Variant", request.variant_id)
    try:
        axes = [Axis(a.path, a.from_, a.to, a.step) for a in request.axes]
        points = grid(axes, request.budget.max_points)
    except BudgetExceeded as exc:
        raise InvalidRequestError(
            ErrorDetail(
                code=ErrorCode.EXPERIMENT_BUDGET_EXCEEDED,
                message=str(exc),
                details={"points_needed": exc.points_needed, "max_points": exc.max_points},
            )
        ) from exc
    except ValueError as exc:
        raise InvalidRequestError(
            ErrorDetail(code=ErrorCode.INVALID_SCENARIO_FIELD, message=str(exc))
        ) from exc

    # Validate every requested point before writing the experiment.  A syntactically
    # valid path can still name a plane absent from this particular variant; that is
    # a client error, not a half-created experiment followed by a 500.
    try:
        planned_points = [
            (
                point,
                canonical := apply_point(base.scenario, point),
                scenarios.parse_stored(canonical),
            )
            for point in points
        ]
    except ValueError as exc:
        raise InvalidRequestError(
            ErrorDetail(code=ErrorCode.INVALID_SCENARIO_FIELD, message=str(exc))
        ) from exc

    experiment = models.Experiment(
        project_id=base.project_id,
        base_variant_id=base.id,
        axes=[a.model_dump(by_alias=True) for a in request.axes],
        budget=request.budget.model_dump(),
        routing_policy=request.routing_policy,
        status=RunStatus.QUEUED,
    )
    session.add(experiment)
    await session.flush()
    run_ids: list[UUID] = []
    seen: dict[str, models.ExperimentPoint] = {}
    for point, canonical, parsed in planned_points:
        config_hash = scenarios.config_hash(parsed)
        existing = seen.get(config_hash)
        ep = models.ExperimentPoint(
            experiment_id=experiment.id, params=point.params, config_hash=config_hash
        )
        session.add(ep)
        if existing is not None:
            ep.run_id = existing.run_id
            continue
        run_config_hash = scenarios.run_config_hash(parsed, str(request.routing_policy))
        reusable = await RunRepository(session).find_active(run_config_hash, ENGINE_VERSION)
        if reusable is not None:
            ep.run_id = reusable.id
            seen[config_hash] = ep
            continue
        variant = models.Variant(
            project_id=base.project_id,
            parent_variant_id=base.id,
            title=f"{base.title} · sweep",
            scenario=canonical,
            diff_from_parent=serialization.from_diff(diff.scenario_diff(base.scenario, canonical)),
            config_hash=config_hash,
            experiment_id=experiment.id,
        )
        session.add(variant)
        await session.flush()
        run = models.Run(
            variant_id=variant.id,
            routing_policy=request.routing_policy,
            engine_version=ENGINE_VERSION,
            config_hash=run_config_hash,
            status=RunStatus.QUEUED,
            stage=RunStage.VALIDATE,
            progress=0.0,
            completed_ticks=0,
            total_ticks=parsed.ticks,
        )
        session.add(run)
        await session.flush()
        JobRepository(session).enqueue_run(run.id)
        ep.run_id = run.id
        seen[config_hash] = ep
        run_ids.append(run.id)
    await session.commit()
    experiment.status = RunStatus.RUNNING
    await session.commit()
    for run_id in run_ids:
        await runtime.submit(run_id)
    return await get_experiment(session, runtime, experiment.id)


async def get_experiment(
    session: AsyncSession, runtime: RunRuntime, experiment_id: UUID
) -> ExperimentSchema:
    experiment = await ExperimentRepository(session).get(experiment_id)
    if experiment is None:
        raise EntityNotFoundError(EXPERIMENT_ENTITY, experiment_id)
    points = await _points(session, experiment_id)
    completed = sum(1 for p in points if p.is_finished)
    statuses = [p.run_status for p in points if p.point.run_id is not None]
    if statuses and all(status in TERMINAL_STATUSES for status in statuses):
        if any(status == RunStatus.FAILED for status in statuses):
            experiment.status = RunStatus.FAILED
            experiment.error = {
                "code": "SWEEP_POINT_FAILED",
                "message": "one or more sweep points failed",
            }
        elif any(status == RunStatus.CANCELLED for status in statuses):
            experiment.status = RunStatus.CANCELLED
        else:
            experiment.status = RunStatus.SUCCEEDED
    elif experiment.status in {RunStatus.QUEUED, RunStatus.RUNNING} and experiment.created_at:
        created = experiment.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        elapsed = (datetime.now(UTC) - created).total_seconds()
        max_seconds = int(experiment.budget.get("max_seconds", 0))
        if max_seconds > 0 and elapsed >= max_seconds:
            experiment.status = RunStatus.CANCELLED
            experiment.error = {
                "code": "EXPERIMENT_BUDGET_EXCEEDED",
                "message": "time budget exceeded",
                "elapsed_seconds": elapsed,
            }
            for run_id in await _owned_active_run_ids(session, experiment.id, points):
                await runtime.request_cancel(run_id)
    if experiment.status in TERMINAL_STATUSES:
        await session.commit()
    return _serialize_experiment(experiment, points, len(points), completed)


async def list_points(session: AsyncSession, experiment_id: UUID) -> list[PointSchema]:
    experiment = await ExperimentRepository(session).get(experiment_id)
    if experiment is None:
        raise EntityNotFoundError(EXPERIMENT_ENTITY, experiment_id)
    return [p.point for p in await _points(session, experiment_id)]


async def materialize(
    session: AsyncSession, experiment_id: UUID, point_id: UUID, title: str
) -> VariantSchema:
    exp = await ExperimentRepository(session).get(experiment_id)
    point = await ExperimentRepository(session).get_point(point_id)
    if exp is None:
        raise EntityNotFoundError(EXPERIMENT_ENTITY, experiment_id)
    if point is None or point.experiment_id != experiment_id:
        raise EntityNotFoundError("Experiment point", point_id)
    base = await VariantRepository(session).get(exp.base_variant_id)
    if base is None:
        raise EntityNotFoundError("Variant", exp.base_variant_id)
    canonical = apply_point(
        base.scenario, Point(tuple((str(k), float(v)) for k, v in point.params.items()))
    )
    parsed = scenarios.parse_stored(canonical)
    variant = models.Variant(
        project_id=base.project_id,
        parent_variant_id=base.id,
        title=title.strip() or base.title,
        scenario=canonical,
        diff_from_parent=serialization.from_diff(diff.scenario_diff(base.scenario, canonical)),
        config_hash=scenarios.config_hash(parsed),
    )
    session.add(variant)
    await session.commit()
    return serialization.to_variant(variant)


async def cancel_experiment(
    session: AsyncSession,
    runtime: RunRuntime,
    experiment_id: UUID,
) -> ExperimentSchema:
    """Cancel unfinished runs created by this sweep without touching reused runs.

    A point may reuse an already active run belonging to a manual variant or a
    different experiment.  Such a run is shared work and must not be cancelled by
    cancelling this experiment.
    """
    experiment = await ExperimentRepository(session).get(experiment_id)
    if experiment is None:
        raise EntityNotFoundError(EXPERIMENT_ENTITY, experiment_id)
    points = await _points(session, experiment_id)
    if experiment.status not in TERMINAL_STATUSES:
        experiment.status = RunStatus.CANCELLED
        experiment.error = {"code": "CANCELLED", "message": "cancelled by user"}
        await session.commit()
        for run_id in await _owned_active_run_ids(session, experiment.id, points):
            await runtime.request_cancel(run_id)
    completed = sum(1 for point in points if point.is_finished)
    return _serialize_experiment(experiment, points, len(points), completed)


async def _points(session: AsyncSession, experiment_id: UUID) -> list[PointState]:
    rows = await ExperimentRepository(session).points_of(experiment_id)
    if not rows:
        return []
    run_ids = [p.run_id for p in rows if p.run_id]
    runs = (
        {
            r.id: r
            for r in (
                await session.scalars(select(models.Run).where(models.Run.id.in_(run_ids)))
            ).all()
        }
        if run_ids
        else {}
    )
    configs = (
        {
            c.run_id: c
            for c in (
                await session.scalars(
                    select(models.ConfigMetrics).where(models.ConfigMetrics.run_id.in_(run_ids))
                )
            ).all()
        }
        if run_ids
        else {}
    )
    out: list[PointState] = []
    for p in rows:
        run = runs.get(p.run_id) if p.run_id is not None else None
        cfg = configs.get(p.run_id) if p.run_id is not None else None
        if cfg is not None:
            # Метрики копируются в строку точки: после удаления запуска по TTL heatmap
            # должен остаться, а `run_id` обнулится (`06_STORAGE.md` §6).
            p.min_client_availability = cfg.min_client_availability
            p.worst_max_gap_s = cfg.worst_max_gap_s
            p.mean_client_availability = cfg.mean_client_availability
        point = PointSchema(
            id=p.id,
            experiment_id=p.experiment_id,
            params=p.params,
            config_hash=p.config_hash,
            run_id=p.run_id,
            min_client_availability=p.min_client_availability,
            worst_max_gap_s=p.worst_max_gap_s,
            mean_client_availability=p.mean_client_availability,
        )
        out.append(PointState(point, run.status if run is not None else RunStatus.QUEUED))
    return out


async def _owned_active_run_ids(
    session: AsyncSession,
    experiment_id: UUID,
    points: Sequence[PointState],
) -> set[UUID]:
    """Return active runs whose transient variant belongs to this experiment."""
    active_ids = {
        state.point.run_id
        for state in points
        if state.point.run_id is not None and state.run_status not in TERMINAL_STATUSES
    }
    if not active_ids:
        return set()
    result = await session.scalars(
        select(models.Run.id)
        .join(models.Variant, models.Variant.id == models.Run.variant_id)
        .where(
            models.Run.id.in_(active_ids),
            models.Variant.experiment_id == experiment_id,
        )
    )
    return set(result.all())


def _serialize_experiment(
    e: models.Experiment, points: Sequence[PointState], total: int, completed: int
) -> ExperimentSchema:
    ranked = sorted(
        (state.point for state in points if state.point.min_client_availability is not None),
        key=_rank_key,
    )[:5]
    return ExperimentSchema(
        id=e.id,
        project_id=e.project_id,
        base_variant_id=e.base_variant_id,
        axes=[ExperimentAxis.model_validate(a) for a in e.axes],
        budget=ExperimentBudget.model_validate(e.budget),
        routing_policy=e.routing_policy,
        status=e.status,
        created_at=e.created_at or datetime.now(UTC),
        completed_points=completed,
        total_points=total,
        progress=completed / total if total else 1.0,
        best_points=list(ranked),
    )


def _rank_key(point: PointSchema) -> tuple[float, float, float]:
    """Лучше та точка, у которой выше худшая доступность, короче худший перерыв и выше средняя.

    Нулевой перерыв — лучший возможный, поэтому неизвестный перерыв заменяется
    бесконечностью явной проверкой на `None`, а не через `or`.
    """
    worst_gap = math.inf if point.worst_max_gap_s is None else point.worst_max_gap_s
    return (
        -(point.min_client_availability or 0.0),
        worst_gap,
        -(point.mean_client_availability or 0.0),
    )
