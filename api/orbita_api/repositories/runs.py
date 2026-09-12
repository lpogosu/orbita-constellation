"""Выборки таблицы `runs`."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class RunRepository:
    """Запуски расчёта. Создание запусков появится вместе с очередью."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, run_id: UUID) -> models.Run | None:
        return await self._session.get(models.Run, run_id)

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
