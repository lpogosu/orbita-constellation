"""Выборки и запись таблицы `variants`."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class VariantRepository:
    """Варианты сценария."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, variant: models.Variant) -> None:
        self._session.add(variant)

    async def get(self, variant_id: UUID) -> models.Variant | None:
        return await self._session.get(models.Variant, variant_id)

    async def list_for_project(self, project_id: UUID) -> Sequence[models.Variant]:
        """Варианты в порядке появления: так читается история изменений проекта."""
        statement = (
            select(models.Variant)
            .where(models.Variant.project_id == project_id)
            .order_by(models.Variant.created_at, models.Variant.id)
        )
        result = await self._session.scalars(statement)
        return result.all()
