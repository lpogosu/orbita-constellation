"""Журнал задач воркера (`06_STORAGE.md` §3, §7).

Очередь живёт в Redis; эта таблица хранит историю попыток, чтобы после падения воркера
было видно, сколько раз задача бралась в работу и чем закончилась.
"""

from typing import Any, Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models
from orbita_api.schemas.common import RunStatus

# Вид задачи совпадает с именем функции arq: по журналу должно быть видно, что именно
# ставилось в очередь.
RUN_CALCULATION_KIND: Final[str] = "run_calculation"
CRITICALITY_KIND: Final[str] = "criticality_analysis"


class JobRepository:
    """Строки журнала задач."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def enqueue_run(self, run_id: UUID) -> models.Job:
        """Заводит запись о поставленной в очередь задаче расчёта."""
        job = models.Job(
            kind=RUN_CALCULATION_KIND,
            payload=_run_payload(run_id),
            status=RunStatus.QUEUED,
            attempts=0,
        )
        self._session.add(job)
        return job

    async def find_for_run(self, run_id: UUID) -> models.Job | None:
        """Последняя запись журнала для запуска.

        Связи по внешнему ключу у журнала нет намеренно (`06_STORAGE.md` §3), поэтому
        поиск идёт по полю `payload`.
        """
        statement = (
            select(models.Job)
            .where(
                models.Job.kind == RUN_CALCULATION_KIND,
                models.Job.payload["run_id"].astext == str(run_id),
            )
            .order_by(models.Job.enqueued_at.desc())
            .limit(1)
        )
        result = await self._session.scalars(statement)
        return result.first()

    async def start_attempt(self, run_id: UUID) -> models.Job:
        """Отмечает очередную попытку выполнить задачу.

        Строку создаёт api при постановке в очередь, но воркер не вправе на это
        рассчитывать: задачу можно поставить и напрямую, а после сбоя arq берёт её
        повторно. Поэтому запись либо находится, либо заводится здесь, а счётчик попыток
        растёт при каждом входе в задачу.
        """
        job = await self.find_for_run(run_id)
        if job is None:
            job = self.enqueue_run(run_id)
        job.attempts += 1
        return job

    def enqueue_criticality(self, run_id: UUID) -> models.Job:
        """Create a persisted resilience-analysis job.

        The report is kept in the JSON payload so this lifecycle works in both the
        normal Postgres deployment and degraded/local storage mode without a new
        migration or a second report table.
        """
        job = models.Job(
            kind=CRITICALITY_KIND,
            payload={"run_id": str(run_id), "progress": 0.0},
            status=RunStatus.QUEUED,
            attempts=0,
        )
        self._session.add(job)
        return job

    async def find_for_criticality(self, run_id: UUID) -> models.Job | None:
        statement = (
            select(models.Job)
            .where(
                models.Job.kind == CRITICALITY_KIND,
                models.Job.payload["run_id"].astext == str(run_id),
            )
            .order_by(models.Job.enqueued_at.desc())
            .limit(1)
            # Progress and cancellation may be written from another request (or API
            # process).  Reuse of an identity-map object here would otherwise hide
            # the new state from the criticality worker.
            .execution_options(populate_existing=True)
        )
        result = await self._session.scalars(statement)
        return result.first()


def _run_payload(run_id: UUID) -> dict[str, Any]:
    return {"run_id": str(run_id)}
