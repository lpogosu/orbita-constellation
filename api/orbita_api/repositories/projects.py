"""Выборки и запись таблицы `projects`."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class ProjectRepository:
    """Проекты. Ни одного правила предметной области: только запросы."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, project: models.Project) -> None:
        self._session.add(project)

    async def get(self, project_id: UUID) -> models.Project | None:
        return await self._session.get(models.Project, project_id)

    async def list_all(self) -> Sequence[models.Project]:
        """Свежие проекты сверху: список открывается как продолжение работы."""
        statement = select(models.Project).order_by(models.Project.created_at.desc())
        result = await self._session.scalars(statement)
        return result.all()
