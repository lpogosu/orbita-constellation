"""Анализ устойчивости конфигурации (`05_API.md` §2, ADR-007)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry, get_storage_registry
from orbita_api.db.session import get_session
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.results import CriticalityJobStatus, CriticalityReport, CriticalityRequest
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
    try:
        return await criticality.run_criticality(session, storage, request.run_id)
    except criticality.CriticalityJobCancelledError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except criticality.CriticalityJobInProgressError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except criticality.CriticalityJobFailedError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error


@router.get(
    "/analysis/criticality/{run_id}/status",
    include_in_schema=False,
    response_model=CriticalityJobStatus,
    summary="Статус и результат persisted resilience job",
    responses=error_responses(404),
)
async def criticality_status(run_id: UUID, session: Session) -> CriticalityJobStatus:
    state = await criticality.get_criticality_status(session, run_id)
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="criticality job not found",
        )
    if state.get("result") is not None:
        state["result"] = CriticalityReport.model_validate(state["result"])
    return CriticalityJobStatus.model_validate(state)


@router.post(
    "/analysis/criticality/{run_id}/cancel",
    include_in_schema=False,
    response_model=CriticalityJobStatus,
    summary="Отменить resilience job",
    responses=error_responses(404, 409),
)
async def cancel_criticality(run_id: UUID, session: Session) -> CriticalityJobStatus:
    state = await criticality.cancel_criticality(session, run_id)
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="criticality job not found",
        )
    if state.get("status") in {"succeeded", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="criticality job already finished",
        )
    if state.get("result") is not None:
        state["result"] = CriticalityReport.model_validate(state["result"])
    return CriticalityJobStatus.model_validate(state)
