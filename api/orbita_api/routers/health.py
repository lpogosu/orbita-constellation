from typing import Annotated

from fastapi import APIRouter, Depends
from orbita_core import ENGINE_VERSION

from orbita_api import API_VERSION
from orbita_api.adapters.registry import DEGRADED_MODE_SERVICES, ProbeRegistry, get_registry
from orbita_api.schemas import HealthResponse, ServiceStatus, VersionResponse

router = APIRouter(tags=["service"])


@router.get("/health", response_model=HealthResponse, summary="Состояние сервисов стека")
async def get_health(
    registry: Annotated[ProbeRegistry, Depends(get_registry)],
) -> HealthResponse:
    """Возвращает 200 всегда, даже когда хранилища недоступны.

    Health — инструмент диагностики: если он начнёт отвечать ошибкой при первом же
    отказе, по нему нельзя будет понять, что именно упало.
    """
    services = await registry.collect()
    degraded = any(
        services.get(service) is ServiceStatus.DOWN for service in DEGRADED_MODE_SERVICES
    )
    return HealthResponse(services=services, degraded_mode=degraded)


@router.get("/version", response_model=VersionResponse, summary="Версии API и ядра")
async def get_version() -> VersionResponse:
    return VersionResponse(api_version=API_VERSION, engine_version=ENGINE_VERSION)
