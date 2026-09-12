"""Сравнение запусков и рекомендация (`05_API.md` §2, ADR-006)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry, get_storage_registry
from orbita_api.db.session import get_session
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.results import ComparisonRequest, ComparisonResult, Recommendation
from orbita_api.services import comparisons

router = APIRouter(tags=["comparisons"])

Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[StorageRegistry, Depends(get_storage_registry)]


@router.post(
    "/comparisons",
    summary="Метрики запусков рядом, дельты и изменённые параметры",
    responses=error_responses(400, 404, 503),
)
async def compare_runs(
    request: ComparisonRequest,
    session: Session,
    storage: Storage,
) -> ComparisonResult:
    """Сравнивает запуски на одной сетке времени.

    Базой считается первый запуск списка: дельты должны отсчитываться от того варианта,
    с которым инженер сравнивает, а не от лучшего по метрикам.
    """
    return await comparisons.compare(session, storage, request.run_ids)


@router.get(
    "/runs/{run_id}/recommendation",
    summary="Рекомендация по конфигурации с обоснованием",
    responses=error_responses(400, 404, 503),
)
async def get_run_recommendation(
    run_id: UUID,
    base_run_id: Annotated[
        UUID,
        Query(description="Запуск, относительно которого считаются дельты"),
    ],
    session: Session,
) -> Recommendation:
    """Строит рекомендацию детерминированно из сохранённых метрик (ADR-006, ADR-012)."""
    return await comparisons.recommend(session, run_id, base_run_id)
