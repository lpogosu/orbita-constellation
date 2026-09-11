"""Правила работы с проектами: создание, чтение, граф происхождения вариантов.

Сервис не выполняет SQL (это делает репозиторий) и не считает ничего, что относится к
расчёту (это делает `orbita_core`).
"""

from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError
from orbita_api.repositories import ProjectRepository, RunRepository, VariantRepository
from orbita_api.schemas.projects import (
    LineageEdge,
    LineageGraph,
    LineageNode,
    Project,
    ProjectCreateRequest,
    ProjectDetail,
)
from orbita_api.services import scenarios, serialization

PROJECT_ENTITY: Final[str] = "Проект"

# Сколько запусков показывать на экране проекта. Полная история запусков открывается
# отдельным экраном сравнения, и тянуть её в ответ списка вариантов незачем.
RECENT_RUNS_LIMIT: Final[int] = 20


async def create_project(session: AsyncSession, request: ProjectCreateRequest) -> Project:
    """Заводит проект и его первый вариант из загруженного сценария.

    Первый вариант — корень дерева: родителя у него нет и diff пуст. Проект без вариантов
    не создаётся: пустой проект нечего показывать и не с чем сравнивать.
    """
    scenario = scenarios.parse(request.scenario)
    title = scenarios.title_for(request.title, request.scenario)

    project = models.Project(title=title)
    ProjectRepository(session).add(project)
    # flush, а не commit: идентификатор проекта нужен варианту, но обе строки обязаны
    # появиться одной транзакцией — проект без активного варианта не существует.
    await session.flush()

    variant = models.Variant(
        project_id=project.id,
        parent_variant_id=None,
        title=title,
        scenario=scenarios.canonical_dict(scenario),
        diff_from_parent=[],
        config_hash=scenarios.config_hash(scenario),
    )
    VariantRepository(session).add(variant)
    await session.flush()

    project.active_variant_id = variant.id
    await session.commit()
    return serialization.to_project(project)


async def list_projects(session: AsyncSession) -> list[Project]:
    projects = await ProjectRepository(session).list_all()
    return [serialization.to_project(project) for project in projects]


async def get_project(session: AsyncSession, project_id: UUID) -> ProjectDetail:
    """Всё, что нужно экрану проекта, одним запросом (`05_API.md` §2)."""
    project = await require_project(session, project_id)
    variants = await VariantRepository(session).list_for_project(project_id)
    runs = await RunRepository(session).list_recent_for_project(project_id, RECENT_RUNS_LIMIT)
    return ProjectDetail(
        project=serialization.to_project(project),
        variants=[serialization.to_variant(variant) for variant in variants],
        recent_runs=[serialization.to_run(run) for run in runs],
    )


async def get_lineage(session: AsyncSession, project_id: UUID) -> LineageGraph:
    """Дерево вариантов с diff на рёбрах.

    Показатели запусков и дельты метрик остаются пустыми: их источник — сохранённые Run,
    а сохранение Run и графовые запросы к Memgraph относятся к следующим срезам
    (`06_STORAGE.md` §4).
    """
    await require_project(session, project_id)
    variants = await VariantRepository(session).list_for_project(project_id)
    nodes = [
        LineageNode(
            variant_id=variant.id,
            title=variant.title,
            config_hash=variant.config_hash,
        )
        for variant in variants
    ]
    known_ids = {variant.id for variant in variants}
    edges: list[LineageEdge] = []
    for variant in variants:
        parent_id = variant.parent_variant_id
        # Корень дерева и вариант, родитель которого удалён, рёбер не дают.
        if parent_id is None or parent_id not in known_ids:
            continue
        edges.append(
            LineageEdge(
                parent_variant_id=parent_id,
                child_variant_id=variant.id,
                diff=serialization.to_diff(variant.diff_from_parent),
            ),
        )
    return LineageGraph(project_id=project_id, nodes=nodes, edges=edges)


async def require_project(session: AsyncSession, project_id: UUID) -> models.Project:
    """Проект или 404: обработчику незачем повторять эту проверку в каждом endpoint."""
    project = await ProjectRepository(session).get(project_id)
    if project is None:
        raise EntityNotFoundError(PROJECT_ENTITY, project_id)
    return project
