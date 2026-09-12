"""Persistence queries for configuration experiments."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class ExperimentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, experiment: models.Experiment) -> None:
        self._session.add(experiment)

    def add_point(self, point: models.ExperimentPoint) -> None:
        self._session.add(point)

    async def get(self, experiment_id: UUID) -> models.Experiment | None:
        return await self._session.get(models.Experiment, experiment_id)

    async def get_point(self, point_id: UUID) -> models.ExperimentPoint | None:
        return await self._session.get(models.ExperimentPoint, point_id)

    async def points_of(self, experiment_id: UUID) -> Sequence[models.ExperimentPoint]:
        result = await self._session.scalars(
            select(models.ExperimentPoint)
            .where(models.ExperimentPoint.experiment_id == experiment_id)
            .order_by(models.ExperimentPoint.id)
        )
        return result.all()

    async def variant_of_config(
        self, experiment_id: UUID, config_hash: str
    ) -> models.Variant | None:
        result = await self._session.scalars(
            select(models.Variant)
            .where(
                models.Variant.experiment_id == experiment_id,
                models.Variant.config_hash == config_hash,
            )
            .limit(1)
        )
        return result.first()
