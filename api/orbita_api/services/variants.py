"""Правила работы с вариантами: сохранение, чтение, выгрузка effective scenario."""

from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError
from orbita_api.repositories import VariantRepository
from orbita_api.schemas.projects import Variant, VariantCreateRequest
from orbita_api.schemas.scenario import Scenario
from orbita_api.services import diff, projects, scenarios, serialization

VARIANT_ENTITY: Final[str] = "Вариант"


async def create_variant(
    session: AsyncSession,
    project_id: UUID,
    request: VariantCreateRequest,
) -> Variant:
    """Сохраняет сценарий новым вариантом проекта и делает его активным.

    Вариант создаётся даже тогда, когда сценарий совпал с родительским и diff пуст:
    пользователь нажал «сохранить», и отказ выглядел бы потерей работы. Совпадение видно
    по одинаковому `config_hash` соседних узлов дерева.
    """
    project = await projects.require_project(session, project_id)
    scenario = scenarios.parse(request.scenario)
    repository = VariantRepository(session)

    # Родитель по умолчанию — активный вариант: пользователь правит то, что открыто.
    parent_id = request.parent_variant_id or project.active_variant_id
    parent = await _require_parent(repository, project_id, parent_id)

    canonical = scenarios.canonical_dict(scenario)
    changes = diff.scenario_diff(parent.scenario, canonical) if parent is not None else []

    variant = models.Variant(
        project_id=project_id,
        parent_variant_id=parent.id if parent is not None else None,
        title=scenarios.title_for(request.title, request.scenario),
        scenario=canonical,
        diff_from_parent=serialization.from_diff(changes),
        config_hash=scenarios.config_hash(scenario),
    )
    repository.add(variant)
    await session.flush()

    project.active_variant_id = variant.id
    await session.commit()
    return serialization.to_variant(variant)


async def get_variant(session: AsyncSession, variant_id: UUID) -> Variant:
    return serialization.to_variant(await _require_variant(session, variant_id))


async def export_variant(session: AsyncSession, variant_id: UUID) -> Scenario:
    """Effective scenario варианта.

    Отдаётся канонический сценарий — ровно то, что пойдёт в расчёт. Он снова проходит
    `POST /api/scenarios/validate` без ошибок: этого требует кейс о повторной загрузке
    изменённого файла (`01_SPEC.md` §6).
    """
    variant = await _require_variant(session, variant_id)
    return serialization.to_scenario(variant.scenario)


async def _require_variant(session: AsyncSession, variant_id: UUID) -> models.Variant:
    variant = await VariantRepository(session).get(variant_id)
    if variant is None:
        raise EntityNotFoundError(VARIANT_ENTITY, variant_id)
    return variant


async def _require_parent(
    repository: VariantRepository,
    project_id: UUID,
    parent_id: UUID | None,
) -> models.Variant | None:
    """Родительский вариант, если он задан.

    Вариант чужого проекта считается ненайденным, а не запрещённым: иначе ответ выдал бы
    существование проекта, к которому запрос отношения не имеет.
    """
    if parent_id is None:
        return None
    parent = await repository.get(parent_id)
    if parent is None or parent.project_id != project_id:
        raise EntityNotFoundError(VARIANT_ENTITY, parent_id)
    return parent
