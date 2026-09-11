"""Сравнение запусков и рекомендация (`05_API.md` §2, ADR-006)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from orbita_api.error_handling import EndpointNotImplementedError
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.results import ComparisonRequest, ComparisonResult, Recommendation

router = APIRouter(tags=["comparisons"])


@router.post(
    "/comparisons",
    summary="Метрики запусков рядом, дельты и изменённые параметры",
    responses=error_responses(400, 404, 501, 503),
)
async def compare_runs(request: ComparisonRequest) -> ComparisonResult:
    """Сравнивает запуски на одной сетке времени.

    Базой считается первый запуск списка: дельты должны отсчитываться от того варианта,
    с которым инженер сравнивает, а не от лучшего по метрикам.
    """
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/recommendation",
    summary="Рекомендация по конфигурации с обоснованием",
    responses=error_responses(400, 404, 501, 503),
)
async def get_run_recommendation(
    run_id: UUID,
    base_run_id: Annotated[
        UUID,
        Query(description="Запуск, относительно которого считаются дельты"),
    ],
) -> Recommendation:
    """Строит рекомендацию детерминированно из сохранённых метрик (ADR-006, ADR-012)."""
    raise EndpointNotImplementedError
