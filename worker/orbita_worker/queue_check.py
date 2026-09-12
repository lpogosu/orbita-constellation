"""Сквозная проверка очереди: `python -m orbita_worker.queue_check`.

Ставит задачу `ping` и ждёт её результат. Используется в `make demo`, чтобы показать,
что связка api → Redis → worker работает целиком, а не только что контейнеры запущены.
Код возврата 1 означает, что результат не пришёл за отведённое время.
"""

import asyncio
import json
import sys

from arq import create_pool

from orbita_worker.keys import QUEUE_NAME
from orbita_worker.settings import redis_settings

RESULT_TIMEOUT_S = 15.0


async def run_check() -> dict[str, str]:
    pool = await create_pool(redis_settings(), default_queue_name=QUEUE_NAME)
    try:
        job = await pool.enqueue_job("ping")
        if job is None:
            raise RuntimeError("Задача не поставлена в очередь")
        result = await job.result(timeout=RESULT_TIMEOUT_S)
    finally:
        await pool.aclose()
    if not isinstance(result, dict):
        raise TypeError(f"Неожиданный результат задачи: {result!r}")
    return {str(key): str(value) for key, value in result.items()}


def main() -> int:
    try:
        payload = asyncio.run(run_check())
    except Exception as error:
        print(f"Очередь недоступна: {error}", file=sys.stderr)
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
