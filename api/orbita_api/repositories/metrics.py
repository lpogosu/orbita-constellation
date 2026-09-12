"""Запись и чтение результата расчёта: метрики клиентов, конфигурации и перерывы."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class MetricsRepository:
    """Строки результата одного запуска."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def replace_for_run(
        self,
        run_id: UUID,
        clients: Sequence[models.ClientMetrics],
        config: models.ConfigMetrics,
        outages: Sequence[models.OutageInterval],
    ) -> None:
        """Кладёт результат запуска, затирая результат предыдущей попытки.

        Задача может выполниться повторно после сбоя воркера, и вторая попытка обязана
        оставить ровно один результат, а не удвоить строки. Расчёт детерминирован
        (ADR-011), поэтому затирание не теряет данных. Транзакцию открывает вызывающий:
        метрики, перерывы и статус запуска обязаны появиться вместе (`06_STORAGE.md` §7).
        """
        await self._session.execute(
            delete(models.ClientMetrics).where(models.ClientMetrics.run_id == run_id),
        )
        await self._session.execute(
            delete(models.ConfigMetrics).where(models.ConfigMetrics.run_id == run_id),
        )
        await self._session.execute(
            delete(models.OutageInterval).where(models.OutageInterval.run_id == run_id),
        )
        self._session.add_all(clients)
        self._session.add(config)
        self._session.add_all(outages)

    async def clients_of(self, run_id: UUID) -> Sequence[models.ClientMetrics]:
        """Метрики клиентов запуска в порядке идентификатора пункта.

        Порядок задан явно: ответ API не должен зависеть от того, как Postgres сложил
        строки на диск, иначе два одинаковых запроса дают разный JSON.
        """
        statement = (
            select(models.ClientMetrics)
            .where(models.ClientMetrics.run_id == run_id)
            .order_by(models.ClientMetrics.client_id)
        )
        result = await self._session.scalars(statement)
        return result.all()

    async def config_of(self, run_id: UUID) -> models.ConfigMetrics | None:
        return await self._session.get(models.ConfigMetrics, run_id)

    async def outages_of(self, run_id: UUID) -> Sequence[models.OutageInterval]:
        """Перерывы запуска по клиентам и времени начала: так их читает экран разбора."""
        statement = (
            select(models.OutageInterval)
            .where(models.OutageInterval.run_id == run_id)
            .order_by(models.OutageInterval.client_id, models.OutageInterval.start_s)
        )
        result = await self._session.scalars(statement)
        return result.all()
