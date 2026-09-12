"""Перевод строк таблиц в схемы контракта.

Хранимые формы и формы ответа совпадают не полностью: в базе лежат JSON-документы, в
ответе — типизированные модели. Перевод собран в одном месте, чтобы `Variant` из списка
проекта и `Variant` из `GET /api/variants/{id}` не разъехались.
"""

from typing import Any

from orbita_api.db import models
from orbita_api.schemas.common import ParameterChange
from orbita_api.schemas.errors import ErrorDetail
from orbita_api.schemas.projects import Project, Variant
from orbita_api.schemas.runs import Run
from orbita_api.schemas.scenario import Scenario


def to_project(project: models.Project) -> Project:
    return Project(
        id=project.id,
        title=project.title,
        created_at=project.created_at,
        active_variant_id=project.active_variant_id,
    )


def to_variant(variant: models.Variant) -> Variant:
    return Variant(
        id=variant.id,
        project_id=variant.project_id,
        parent_variant_id=variant.parent_variant_id,
        title=variant.title,
        scenario=to_scenario(variant.scenario),
        diff_from_parent=to_diff(variant.diff_from_parent),
        config_hash=variant.config_hash,
        created_at=variant.created_at,
    )


def to_scenario(stored: dict[str, Any]) -> Scenario:
    """Канонический сценарий из JSONB.

    Проверка при чтении не лишняя: она доказывает, что сохранённый вариант по-прежнему
    соответствует контракту `cosmo-A-1.0`, и ловит расхождение схемы сразу, а не на
    экране пользователя.
    """
    return Scenario.model_validate(stored)


def to_diff(stored: list[Any]) -> list[ParameterChange]:
    # Diff хранится под именами контракта, поэтому поле называется `from`, а не `from_`.
    return [ParameterChange.model_validate(change) for change in stored]


def from_diff(changes: list[ParameterChange]) -> list[Any]:
    return [change.model_dump(by_alias=True) for change in changes]


def to_run(run: models.Run) -> Run:
    return Run(
        id=run.id,
        variant_id=run.variant_id,
        routing_policy=run.routing_policy,
        engine_version=run.engine_version,
        config_hash=run.config_hash,
        status=run.status,
        stage=run.stage,
        progress=run.progress,
        completed_ticks=run.completed_ticks,
        total_ticks=run.total_ticks,
        started_at=run.started_at,
        finished_at=run.finished_at,
        duration_ms=run.duration_ms,
        trace_uri=run.trace_uri,
        degraded_mode=run.degraded_mode,
        error=ErrorDetail.model_validate(run.error) if run.error is not None else None,
    )
