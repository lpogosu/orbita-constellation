"""Выборки и запись таблицы `artifacts`."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class ArtifactRepository:
    """Реестр объектов хранилища: что записано, куда и до какого срока."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, artifact: models.Artifact) -> None:
        self._session.add(artifact)

    async def list_for_run(self, run_id: UUID) -> Sequence[models.Artifact]:
        statement = (
            select(models.Artifact)
            .where(models.Artifact.run_id == run_id)
            .order_by(models.Artifact.kind)
        )
        result = await self._session.scalars(statement)
        return result.all()

    async def delete_kind(self, run_id: UUID, kind: str) -> None:
        """Убирает прежнюю запись того же вида.

        Повторное сохранение артефакта перезаписывает объект по тому же ключу, поэтому
        двух строк на один вид быть не должно: иначе уборка по `expires_at` удалила бы
        объект, на который ссылается вторая строка.
        """
        statement = delete(models.Artifact).where(
            models.Artifact.run_id == run_id,
            models.Artifact.kind == kind,
        )
        await self._session.execute(statement)
