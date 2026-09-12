"""Анализ устойчивости конфигурации (`05_API.md` §2, ADR-007)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry, get_storage_registry
from orbita_api.db.session import get_session
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.results import CriticalityReport, CriticalityRequest
from orbita_api.services import criticality

router = APIRouter(tags=["analysis"])

Session = Annotated[AsyncSession, Depends(get_session)]
Storage = Annotated[StorageRegistry, Depends(get_storage_registry)]


@router.post(
    "/analysis/criticality",
    summary="Resilience X-Ray: вклад каждого аппарата в устойчивость",
    responses=error_responses(400, 404, 503),
)
async def analyze_criticality(
    request: CriticalityRequest,
    session: Session,
    storage: Storage,
) -> CriticalityReport:
    """Контрфактический прогон: что с метриками, если убрать каждый аппарат по очереди."""
    return await criticality.run_criticality(session, storage, request.run_id)
