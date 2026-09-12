"""Sweep по параметрам конфигурации (`05_API.md` §2, `04_CORE.md` §7)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db.session import get_session
from orbita_api.runtime import RunRuntime, get_runtime
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.experiments import (
    Experiment,
    ExperimentCreateRequest,
    ExperimentPoint,
    PointMaterializeRequest,
)
from orbita_api.schemas.projects import Variant
from orbita_api.services import experiments

router = APIRouter(tags=["experiments"])


@router.post(
    "/experiments",
    status_code=status.HTTP_201_CREATED,
    summary="Запустить sweep по одной или двум осям",
    responses=error_responses(400, 404, 422, 503),
)
async def create_experiment(
    request: ExperimentCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    runtime: Annotated[RunRuntime, Depends(get_runtime)],
) -> Experiment:
    """Ставит точки sweep в очередь как независимые задачи.

    Бюджет проверяется до постановки: перебор двух осей без ограничения занимает воркеры
    на часы (`06_STORAGE.md` §7).
    """
    return await experiments.create_experiment(session, runtime, request)


@router.get(
    "/experiments/{experiment_id}",
    summary="Статус, прогресс и лучшие точки",
    responses=error_responses(404, 503),
)
async def get_experiment(
    experiment_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    runtime: Annotated[RunRuntime, Depends(get_runtime)],
) -> Experiment:
    return await experiments.get_experiment(session, runtime, experiment_id)


@router.post(
    "/experiments/{experiment_id}/cancel",
    include_in_schema=False,
    summary="Отменить незавершённые точки sweep",
    responses=error_responses(404, 503),
)
async def cancel_experiment(
    experiment_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    runtime: Annotated[RunRuntime, Depends(get_runtime)],
) -> Experiment:
    return await experiments.cancel_experiment(session, runtime, experiment_id)


@router.get(
    "/experiments/{experiment_id}/points",
    summary="Точки heatmap с метриками",
    responses=error_responses(404, 503),
)
async def list_experiment_points(
    experiment_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> list[ExperimentPoint]:
    return await experiments.list_points(session, experiment_id)


@router.post(
    "/experiments/{experiment_id}/points/{point_id}/materialize",
    status_code=status.HTTP_201_CREATED,
    summary="Создать вариант из точки эксперимента",
    responses=error_responses(400, 404, 503),
)
async def materialize_experiment_point(
    experiment_id: UUID,
    point_id: UUID,
    request: PointMaterializeRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Variant:
    """Превращает точку sweep в сохранённый вариант, чтобы её можно было сравнивать."""
    return await experiments.materialize(session, experiment_id, point_id, request.title)
