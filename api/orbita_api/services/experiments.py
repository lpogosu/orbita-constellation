"""Application service for RAAN/phase configuration sweeps."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
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
    for point in points:
        canonical = apply_point(base.scenario, point)
        parsed = scenarios.parse_stored(canonical)
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
    terminal = {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}
    completed = sum(1 for p in points if p.run_id is not None and p._run_status in terminal)
    statuses = [p._run_status for p in points if p.run_id is not None]
    if statuses and all(s in terminal for s in statuses):
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
            for point in points:
                if point.run_id is not None and point._run_status not in terminal:
                    await runtime.request_cancel(point.run_id)
    if experiment.status in terminal:
        await session.commit()
    return _serialize_experiment(experiment, points, len(points), completed)


async def list_points(session: AsyncSession, experiment_id: UUID) -> list[PointSchema]:
    experiment = await ExperimentRepository(session).get(experiment_id)
    if experiment is None:
        raise EntityNotFoundError(EXPERIMENT_ENTITY, experiment_id)
    return [p._schema for p in await _points(session, experiment_id)]


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


async def _points(session: AsyncSession, experiment_id: UUID) -> list[Any]:
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
    out = []
    for p in rows:
        run = runs.get(p.run_id)
        cfg = configs.get(p.run_id)
        p._run_status = run.status if run else RunStatus.QUEUED
        if cfg:
            p.min_client_availability = cfg.min_client_availability
            p.worst_max_gap_s = cfg.worst_max_gap_s
            p.mean_client_availability = cfg.mean_client_availability
        p._schema = PointSchema.model_validate(
            {
                "id": p.id,
                "experiment_id": p.experiment_id,
                "params": p.params,
                "config_hash": p.config_hash,
                "run_id": p.run_id,
                "min_client_availability": p.min_client_availability,
                "worst_max_gap_s": p.worst_max_gap_s,
                "mean_client_availability": p.mean_client_availability,
            }
        )
        out.append(p)
    return out


def _serialize_experiment(
    e: models.Experiment, points: Sequence[Any], total: int, completed: int
) -> ExperimentSchema:
    ranked = sorted(
        (p._schema for p in points if p.min_client_availability is not None),
        key=lambda p: (
            -p.min_client_availability,
            p.worst_max_gap_s or 10**9,
            -(p.mean_client_availability or 0),
        ),
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
