"""Варианты сценария и их выгрузка (`05_API.md` §2)."""

from uuid import UUID

from fastapi import APIRouter

from orbita_api.error_handling import EndpointNotImplementedError
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.projects import Variant
from orbita_api.schemas.scenario import Scenario

router = APIRouter(tags=["variants"])


@router.get(
    "/variants/{variant_id}",
    summary="Вариант с diff от родителя",
    responses=error_responses(404, 501, 503),
)
async def get_variant(variant_id: UUID) -> Variant:
    raise EndpointNotImplementedError


@router.get(
    "/variants/{variant_id}/export",
    summary="Выгрузить effective scenario",
    responses=error_responses(404, 501, 503),
)
async def export_variant(variant_id: UUID) -> Scenario:
    """Отдаёт сценарий `cosmo-A-1.0` со всеми правками пользователя.

    Выгруженный файл обязан проходить `POST /api/scenarios/validate` без ошибок: это
    требование кейса о повторной загрузке изменённого сценария (`01_SPEC.md` §6).
    """
    raise EndpointNotImplementedError
