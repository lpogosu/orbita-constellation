"""Запуск расчёта, его прогресс и состояние сети на отсчёте (`05_API.md` §1-2)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from orbita_api.schemas.common import EdgeKind, OutageCause, RoutingPolicy, RunStage, RunStatus
from orbita_api.schemas.errors import ErrorDetail
from orbita_api.schemas.scenario import Scenario


class Run(BaseModel):
    """Выполнение расчёта конкретного варианта конкретной версией ядра."""

    id: UUID
    variant_id: UUID
    routing_policy: RoutingPolicy
    engine_version: str = Field(description="Версия ядра, например orbita-core-1.0.0")
    config_hash: str = Field(
        description="sha256 канонического effective scenario и routing_policy (ADR-011)",
    )
    status: RunStatus
    stage: RunStage
    progress: float = Field(description="Доля выполненной работы, [0; 1]")
    completed_ticks: int
    total_ticks: int
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    trace_uri: str | None = Field(
        default=None,
        description="Ключ трассы в MinIO; null, пока трасса не сохранена или уже удалена",
    )
    degraded_mode: bool = Field(
        default=False,
        description=(
            "Артефакты запуска записаны мимо внешних хранилищ: трасса в локальном "
            "каталоге, граф не сохранён (`06_STORAGE.md` §7)"
        ),
    )
    error: ErrorDetail | None = Field(
        default=None,
        description="Заполняется при `status: failed`",
    )


class RunCreateRequest(BaseModel):
    """Тело `POST /api/runs`."""

    variant_id: UUID
    routing_policy: RoutingPolicy = RoutingPolicy.BFS_SHORTEST


class RunProgressEvent(BaseModel):
    """Полезная нагрузка одного SSE-события `GET /api/runs/{id}/events` (`05_API.md` §4)."""

    run_id: UUID
    status: RunStatus
    stage: RunStage
    progress: float
    completed_ticks: int
    total_ticks: int


class SnapshotSatellite(BaseModel):
    """Аппарат на отсчёте. Координаты в земной системе (`01_SPEC.md` §2.3)."""

    id: str
    plane_id: str
    x_km: float
    y_km: float
    z_km: float
    active: bool = Field(description="Участвует в связях на этом отсчёте")
    failed: bool = Field(description="Действует интервал недоступности")


class SnapshotEdge(BaseModel):
    """Доступный контакт на отсчёте."""

    a: str
    b: str
    distance_km: float
    kind: EdgeKind


class ClientRoute(BaseModel):
    """Маршрут клиента до шлюза на отсчёте и причина его отсутствия."""

    client_id: str
    reachable: bool
    path: list[str] = Field(description="Идентификаторы от клиента до шлюза; пусто без маршрута")
    hops: int | None = Field(
        default=None,
        description="Рёбер в маршруте, включая две наземные линии; null без маршрута",
    )
    primary_cause: OutageCause | None = None
    causes: list[OutageCause] = Field(default_factory=list)


class Snapshot(BaseModel):
    """Состояние сети на одном отсчёте."""

    t_s: int
    satellites: list[SnapshotSatellite]
    edges: list[SnapshotEdge]
    clients: list[ClientRoute]


class PreviewRequest(BaseModel):
    """Тело `POST /api/preview`: один отсчёт несохранённого draft, без Run."""

    scenario: Scenario
    t_s: int = Field(ge=0, description="Отсчёт сетки, секунды от начала расчёта")
    routing_policy: RoutingPolicy = RoutingPolicy.BFS_SHORTEST


class ClientTimeline(BaseModel):
    """Доступность одного клиента по всем отсчётам горизонта.

    Отсчётов 720 и больше, поэтому доступность и видимость передаются упакованными битами,
    а не списком объектов на каждый отсчёт (ADR-010).
    """

    client_id: str
    availability_bitset: str = Field(
        description="Упакованные биты «маршрут есть», base64, значимых бит `total_ticks`",
    )
    visibility_bitset: str = Field(
        description="Упакованные биты «виден активный спутник», base64",
    )
    causes: list[OutageCause | None] = Field(
        description="Причина по каждому отсчёту, длина `total_ticks`; null там, где маршрут есть",
    )


class RunTimeline(BaseModel):
    """Ответ `GET /api/runs/{id}/timeline`."""

    run_id: UUID
    total_ticks: int
    step_s: int
    clients: list[ClientTimeline]


class BackupPaths(BaseModel):
    """Вершинно-непересекающиеся маршруты и минимальный разрез на отсчёте (ADR-007)."""

    run_id: UUID
    t_s: int
    client_id: str
    backup_path_count: int = Field(description="Число вершинно-непересекающихся маршрутов")
    paths: list[list[str]]
    min_cut_satellites: list[str] = Field(
        description="Аппараты минимального разреза: без них маршрута нет",
    )
