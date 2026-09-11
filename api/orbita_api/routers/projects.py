"""Проекты, их варианты и граф происхождения (`05_API.md` §2)."""

from uuid import UUID

from fastapi import APIRouter, status

from orbita_api.error_handling import EndpointNotImplementedError
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.projects import (
    LineageGraph,
    Project,
    ProjectCreateRequest,
    ProjectDetail,
    Variant,
    VariantCreateRequest,
)

router = APIRouter(tags=["projects"])


@router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
    summary="Создать проект из сценария",
    responses=error_responses(400, 501, 503),
)
async def create_project(request: ProjectCreateRequest) -> Project:
    """Создаёт проект и первый вариант из переданного сценария."""
    raise EndpointNotImplementedError


@router.get("/projects", summary="Список проектов", responses=error_responses(501, 503))
async def list_projects() -> list[Project]:
    """Проекты в порядке убывания даты создания."""
    raise EndpointNotImplementedError


@router.get(
    "/projects/{project_id}",
    summary="Проект, его варианты и последние запуски",
    responses=error_responses(404, 501, 503),
)
async def get_project(project_id: UUID) -> ProjectDetail:
    """Всё, что нужно экрану проекта за один запрос."""
    raise EndpointNotImplementedError


@router.post(
    "/projects/{project_id}/variants",
    status_code=status.HTTP_201_CREATED,
    summary="Сохранить новый вариант",
    responses=error_responses(400, 404, 501, 503),
)
async def create_variant(project_id: UUID, request: VariantCreateRequest) -> Variant:
    """Сохраняет draft или загруженный файл как неизменяемый вариант.

    Вариант не редактируется: каждое изменение порождает новый с ссылкой на родителя,
    иначе сравнение вариантов теряет смысл (ADR-011).
    """
    raise EndpointNotImplementedError


@router.get(
    "/projects/{project_id}/lineage",
    summary="Граф происхождения вариантов с дельтами метрик",
    responses=error_responses(404, 501, 503),
)
async def get_project_lineage(project_id: UUID) -> LineageGraph:
    """Кто из какого варианта создан и что это дало по метрикам."""
    raise EndpointNotImplementedError
