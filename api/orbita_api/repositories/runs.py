"""Выборки и запись таблицы `runs`."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models
from orbita_api.schemas.common import RoutingPolicy, RunStatus


class RunRepository:
    """Запуски расчёта. Ни одного правила предметной области: только запросы."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, run: models.Run) -> None:
        self._session.add(run)

    async def get(self, run_id: UUID) -> models.Run | None:
        return await self._session.get(models.Run, run_id)

    async def find_active(
        self,
        config_hash: str,
        engine_version: str,
    ) -> models.Run | None:
        """Запуск, который уже отвечает на тот же вопрос (ADR-011).

        Ищутся состояния из `ACTIVE_RUN_STATUSES`: успешный переиспользуется целиком, а
        стоящий в очереди или считающийся даст тот же результат, и второй расчёт той же
        конфигурации занял бы воркер впустую. Частичный уникальный индекс по той же паре
        гарантирует, что такой запуск не более одного.
        """
        statement = (
            select(models.Run)
            .where(
                models.Run.config_hash == config_hash,
                models.Run.engine_version == engine_version,
                models.Run.status.in_(models.ACTIVE_RUN_STATUSES),
            )
            .order_by(models.Run.created_at.desc())
            .limit(1)
        )
        result = await self._session.scalars(statement)
        return result.first()

    async def list_recent_for_project(
        self,
        project_id: UUID,
        limit: int,
    ) -> Sequence[models.Run]:
        """Последние запуски всех вариантов проекта.

        Соединение с `variants` вместо хранения `project_id` в самом запуске: проект
        запуска однозначно определяется вариантом, а дублирование ключа пришлось бы
        поддерживать при каждом переносе варианта.
        """
        statement = (
            select(models.Run)
            .join(models.Variant, models.Variant.id == models.Run.variant_id)
            .where(models.Variant.project_id == project_id)
            .order_by(models.Run.created_at.desc())
            .limit(limit)
        )
        result = await self._session.scalars(statement)
        return result.all()

    async def list_succeeded_siblings(
        self,
        run_id: UUID,
        routing_policy: RoutingPolicy,
    ) -> Sequence[models.Run]:
        """Успешные запуски того же проекта с той же политикой, включая сам `run_id`.

        Это множество кандидатов рекомендации (ADR-006): сравнивать между собой можно
        только расчёты одной задачи, а политика маршрутизации входит в постановку, а не
        в конфигурацию.
        """
        project = (
            select(models.Variant.project_id)
            .join(models.Run, models.Run.variant_id == models.Variant.id)
            .where(models.Run.id == run_id)
            .scalar_subquery()
        )
        statement = (
            select(models.Run)
            .join(models.Variant, models.Variant.id == models.Run.variant_id)
            .where(
                models.Variant.project_id == project,
                models.Run.routing_policy == routing_policy,
                models.Run.status == RunStatus.SUCCEEDED,
            )
            .order_by(models.Run.created_at, models.Run.id)
        )
        result = await self._session.scalars(statement)
        return result.all()
