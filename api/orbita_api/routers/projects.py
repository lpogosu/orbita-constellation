"""Проекты, их варианты и граф происхождения (`05_API.md` §2)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db.session import get_session
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.projects import (
    LineageGraph,
    Project,
    ProjectCreateRequest,
    ProjectDetail,
    Variant,
    VariantCreateRequest,
)
from orbita_api.services import projects, variants

router = APIRouter(tags=["projects"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
    summary="Создать проект из сценария",
    responses=error_responses(400, 503),
)
async def create_project(request: ProjectCreateRequest, session: Session) -> Project:
    """Создаёт проект и первый вариант из переданного сценария."""
    return await projects.create_project(session, request)


@router.get("/projects", summary="Список проектов", responses=error_responses(503))
async def list_projects(session: Session) -> list[Project]:
    """Проекты в порядке убывания даты создания."""
    return await projects.list_projects(session)


@router.get(
    "/projects/{project_id}",
    summary="Проект, его варианты и последние запуски",
    responses=error_responses(404, 503),
)
async def get_project(project_id: UUID, session: Session) -> ProjectDetail:
    """Всё, что нужно экрану проекта за один запрос."""
    return await projects.get_project(session, project_id)


@router.post(
    "/projects/{project_id}/variants",
    status_code=status.HTTP_201_CREATED,
    summary="Сохранить новый вариант",
    responses=error_responses(400, 404, 503),
)
async def create_variant(
    project_id: UUID,
    request: VariantCreateRequest,
    session: Session,
) -> Variant:
    """Сохраняет draft или загруженный файл как неизменяемый вариант.

    Вариант не редактируется: каждое изменение порождает новый с ссылкой на родителя,
    иначе сравнение вариантов теряет смысл (ADR-011).
    """
    return await variants.create_variant(session, project_id, request)


@router.get(
    "/projects/{project_id}/lineage",
    summary="Граф происхождения вариантов с дельтами метрик",
    responses=error_responses(404, 503),
)
async def get_project_lineage(project_id: UUID, session: Session) -> LineageGraph:
    """Кто из какого варианта создан и что это дало по метрикам."""
    return await projects.get_lineage(session, project_id)
