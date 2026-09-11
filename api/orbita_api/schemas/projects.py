"""Проекты, варианты и граф их происхождения (`05_API.md` §1-2, ADR-011)."""

from datetime import datetime
from typing import Final
from uuid import UUID

from pydantic import BaseModel, Field

from orbita_api.schemas.common import ParameterChange
from orbita_api.schemas.runs import Run
from orbita_api.schemas.scenario import Scenario

# Предел длины названия проекта и варианта. Он же длина колонки в базе: иначе слишком
# длинное название возвращало бы 500 из драйвера вместо 400 с указанием поля.
TITLE_MAX_LENGTH: Final[int] = 200


class Project(BaseModel):
    """Контейнер инженерного исследования: варианты, запуски, эксперименты."""

    id: UUID
    title: str
    created_at: datetime
    active_variant_id: UUID | None = Field(
        default=None,
        description="Вариант, открытый в интерфейсе по умолчанию",
    )


class Variant(BaseModel):
    """Неизменяемая версия сценария с diff от родителя."""

    id: UUID
    project_id: UUID
    parent_variant_id: UUID | None = None
    title: str
    scenario: Scenario
    diff_from_parent: list[ParameterChange] = Field(default_factory=list)
    config_hash: str
    created_at: datetime


class ProjectCreateRequest(BaseModel):
    """Тело `POST /api/projects`: проект создаётся сразу с первым вариантом."""

    # Название необязательно: инженер загружает файл кнопкой и не обязан придумывать имя
    # проекту, у сценария уже есть `meta.title`. Пустая строка приравнивается к пропуску,
    # иначе в списке проектов появилась бы безымянная строка.
    title: str | None = Field(
        default=None,
        max_length=TITLE_MAX_LENGTH,
        description="По умолчанию — `meta.title` сценария",
    )
    scenario: Scenario


class VariantCreateRequest(BaseModel):
    """Тело `POST /api/projects/{project_id}/variants`."""

    title: str | None = Field(
        default=None,
        max_length=TITLE_MAX_LENGTH,
        description="По умолчанию — `meta.title` сценария",
    )
    scenario: Scenario
    parent_variant_id: UUID | None = Field(
        default=None,
        description="Родитель для diff и lineage; по умолчанию — активный вариант проекта",
    )


class ProjectDetail(BaseModel):
    """Ответ `GET /api/projects/{project_id}`: проект, его варианты и последние запуски."""

    project: Project
    variants: list[Variant]
    recent_runs: list[Run]


class LineageNode(BaseModel):
    """Вариант в графе происхождения с показателями последнего успешного запуска."""

    variant_id: UUID
    title: str
    config_hash: str
    latest_run_id: UUID | None = None
    min_client_availability: float | None = None
    worst_max_gap_s: int | None = None


class LineageEdge(BaseModel):
    """Связь «потомок создан из родителя» с дельтами метрик (06_STORAGE.md §4)."""

    parent_variant_id: UUID
    child_variant_id: UUID
    diff: list[ParameterChange]
    delta_min_availability: float | None = None
    delta_worst_max_gap_s: int | None = None


class LineageGraph(BaseModel):
    """Ответ `GET /api/projects/{project_id}/lineage`."""

    project_id: UUID
    nodes: list[LineageNode]
    edges: list[LineageEdge]
