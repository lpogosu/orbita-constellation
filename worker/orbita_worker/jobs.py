import os
from typing import Any

from orbita_core import ENGINE_VERSION

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
