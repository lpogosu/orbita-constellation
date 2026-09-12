"""Фоновые задачи ОРБИТЫ.

Воркер вызывает `orbita_core` как библиотеку и общается с api только через Redis:
очередь arq, канал прогресса `run:{id}` и отметку живости (06_STORAGE.md §5).
"""
import os
from typing import Any
from uuid import UUID

from orbita_core import ENGINE_VERSION
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orbita_worker.events import RedisRunEvents
from orbita_worker.runner import execute_run

WorkerContext = dict[Any, Any]


async def ping(ctx: WorkerContext) -> dict[str, str]:
    """Сквозная проверка очереди: задача уходит из api и возвращается результатом.

    Отметка живости в Redis говорит лишь о том, что процесс воркера жив. Эта задача
    проверяет весь путь — enqueue, выборку из очереди, исполнение и запись результата, —
    и заодно показывает, какой версией ядра считает воркер: расхождение версий api и
    воркера ломает переиспользование Run (ADR-011).
    """
    return {
        "worker_id": os.environ.get("HOSTNAME", "unknown"),
        "engine_version": ENGINE_VERSION,
        "job_id": str(ctx.get("job_id", "")),
    }


async def run_calculation(ctx: WorkerContext, run_id: str) -> None:
    """Считает сутки одного варианта и записывает результат.

    Идентификатор запуска приходит строкой: аргументы задачи лежат в Redis, и строка
    читается в `redis-cli` при разборе застрявшей очереди так же, как в коде.
    """
    sessionmaker = ctx["sessionmaker"]
    if not isinstance(sessionmaker, async_sessionmaker):
        raise RuntimeError("Фабрика сессий воркера не создана в on_startup")
    typed_sessionmaker: async_sessionmaker[AsyncSession] = sessionmaker
    await execute_run(UUID(run_id), typed_sessionmaker, RedisRunEvents(ctx["redis"]))
