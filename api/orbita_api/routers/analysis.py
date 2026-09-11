"""Анализ устойчивости конфигурации (`05_API.md` §2, ADR-007)."""

from fastapi import APIRouter

from orbita_api.error_handling import EndpointNotImplementedError
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.results import CriticalityReport, CriticalityRequest

router = APIRouter(tags=["analysis"])


@router.post(
    "/analysis/criticality",
    summary="Resilience X-Ray: вклад каждого аппарата в устойчивость",
    responses=error_responses(400, 404, 501, 503),
)
async def analyze_criticality(request: CriticalityRequest) -> CriticalityReport:
    """Контрфактический прогон: что с метриками, если убрать каждый аппарат по очереди."""
    raise EndpointNotImplementedError
