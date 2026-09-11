"""Варианты сценария и их выгрузка (`05_API.md` §2)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db.session import get_session
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.projects import Variant
from orbita_api.schemas.scenario import Scenario
from orbita_api.services import variants

router = APIRouter(tags=["variants"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/variants/{variant_id}",
    summary="Вариант с diff от родителя",
    responses=error_responses(404, 503),
)
async def get_variant(variant_id: UUID, session: Session) -> Variant:
    return await variants.get_variant(session, variant_id)


@router.get(
    "/variants/{variant_id}/export",
    summary="Выгрузить effective scenario",
    responses=error_responses(404, 503),
)
async def export_variant(variant_id: UUID, session: Session) -> Scenario:
    """Отдаёт сценарий `cosmo-A-1.0` со всеми правками пользователя.

    Выгруженный файл обязан проходить `POST /api/scenarios/validate` без ошибок: это
    требование кейса о повторной загрузке изменённого сценария (`01_SPEC.md` §6).
    """
    return await variants.export_variant(session, variant_id)
