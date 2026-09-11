"""Sweep по параметрам конфигурации и его точки (`05_API.md` §2, `04_CORE.md` §7)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from orbita_api.schemas.common import RoutingPolicy, RunStatus


class ExperimentAxis(BaseModel):
    """Ось sweep: какой параметр перебирается и с каким шагом."""

    # `from` - ключевое слово Python; в JSON поле остаётся под именем из контракта.
    model_config = ConfigDict(populate_by_name=True)

    path: str = Field(description="Путь до параметра, например design.planes[1].raan_deg")
    from_: float = Field(alias="from", description="Начало диапазона включительно")
    to: float = Field(description="Конец диапазона включительно")
    step: float


class ExperimentBudget(BaseModel):
    """Ограничение sweep: без него перебор двух осей не заканчивается (06_STORAGE.md §7)."""

    max_points: int
    max_seconds: int


class ExperimentCreateRequest(BaseModel):
    """Тело `POST /api/experiments`."""

    variant_id: UUID
    axes: list[ExperimentAxis] = Field(min_length=1, max_length=2)
    budget: ExperimentBudget
    routing_policy: RoutingPolicy = RoutingPolicy.BFS_SHORTEST


class ExperimentPoint(BaseModel):
    """Одна конфигурация внутри sweep с её метриками."""

    id: UUID
    experiment_id: UUID
    params: dict[str, float] = Field(description="Значение по каждой оси: путь -> значение")
    config_hash: str
    run_id: UUID | None = Field(default=None, description="null, пока точка не посчитана")
    min_client_availability: float | None = None
    worst_max_gap_s: int | None = None
    mean_client_availability: float | None = None


class Experiment(BaseModel):
    """Sweep целиком: параметры, бюджет, прогресс и лучшие точки."""

    id: UUID
    project_id: UUID
    base_variant_id: UUID
    axes: list[ExperimentAxis]
    budget: ExperimentBudget
    routing_policy: RoutingPolicy
    status: RunStatus
    created_at: datetime
    completed_points: int
    total_points: int
    progress: float = Field(description="Доля посчитанных точек, [0; 1]")
    best_points: list[ExperimentPoint] = Field(
        description="Лучшие точки в порядке ранжирования ADR-006",
    )


class PointMaterializeRequest(BaseModel):
    """Тело `POST /api/experiments/{experiment_id}/points/{point_id}/materialize`."""

    title: str = Field(description="Название будущего варианта")
