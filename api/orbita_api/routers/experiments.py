"""Sweep по параметрам конфигурации (`05_API.md` §2, `04_CORE.md` §7)."""

from uuid import UUID

from fastapi import APIRouter, status

from orbita_api.error_handling import EndpointNotImplementedError
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.experiments import (
    Experiment,
    ExperimentCreateRequest,
    ExperimentPoint,
    PointMaterializeRequest,
)
from orbita_api.schemas.projects import Variant

router = APIRouter(tags=["experiments"])


@router.post(
    "/experiments",
    status_code=status.HTTP_201_CREATED,
    summary="Запустить sweep по одной или двум осям",
    responses=error_responses(400, 404, 422, 501, 503),
)
async def create_experiment(request: ExperimentCreateRequest) -> Experiment:
    """Ставит точки sweep в очередь как независимые задачи.

    Бюджет проверяется до постановки: перебор двух осей без ограничения занимает воркеры
    на часы (`06_STORAGE.md` §7).
    """
    raise EndpointNotImplementedError


@router.get(
    "/experiments/{experiment_id}",
    summary="Статус, прогресс и лучшие точки",
    responses=error_responses(404, 501, 503),
)
async def get_experiment(experiment_id: UUID) -> Experiment:
    raise EndpointNotImplementedError


@router.get(
    "/experiments/{experiment_id}/points",
    summary="Точки heatmap с метриками",
    responses=error_responses(404, 501, 503),
)
async def list_experiment_points(experiment_id: UUID) -> list[ExperimentPoint]:
    raise EndpointNotImplementedError


@router.post(
    "/experiments/{experiment_id}/points/{point_id}/materialize",
    status_code=status.HTTP_201_CREATED,
    summary="Создать вариант из точки эксперимента",
    responses=error_responses(400, 404, 501, 503),
)
async def materialize_experiment_point(
    experiment_id: UUID,
    point_id: UUID,
    request: PointMaterializeRequest,
) -> Variant:
    """Превращает точку sweep в сохранённый вариант, чтобы её можно было сравнивать."""
    raise EndpointNotImplementedError
