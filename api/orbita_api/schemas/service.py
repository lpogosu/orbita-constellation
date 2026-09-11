"""Схемы служебных endpoint `/api/health` и `/api/version`."""

from enum import StrEnum

from pydantic import BaseModel, Field


class ServiceName(StrEnum):
    """Сервисы, состояние которых показывает `/api/health` (06_STORAGE.md §1)."""

    API = "api"
    POSTGRES = "postgres"
    REDIS = "redis"
    MEMGRAPH = "memgraph"
    MINIO = "minio"
    WORKER = "worker"


class ServiceStatus(StrEnum):
    UP = "up"
    DOWN = "down"


class HealthResponse(BaseModel):
    services: dict[ServiceName, ServiceStatus] = Field(
        description="Состояние каждого сервиса стека",
    )
    degraded_mode: bool = Field(
        description=(
            "Хотя бы одно из хранилищ redis, memgraph, minio недоступно: обязательный "
            "расчёт выполняется локальными адаптерами (06_STORAGE.md §7)"
        ),
    )


class VersionResponse(BaseModel):
    api_version: str = Field(description="Версия HTTP-слоя")
    engine_version: str = Field(
        description="Версия расчётного ядра; входит в ключ переиспользования Run (ADR-011)",
    )
