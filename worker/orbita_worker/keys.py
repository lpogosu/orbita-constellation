"""Имена в Redis, общие для api и воркера (`06_STORAGE.md` §5).

Единственный контракт между двумя процессами, кроме самой очереди: api публикует задачи
и читает канал прогресса, воркер читает задачи и пишет в канал. Поэтому имена ключей
объявлены здесь один раз, а не повторяются строками в обоих пакетах.
"""

from typing import Final
from uuid import UUID

QUEUE_NAME: Final[str] = "arq:queue"

# Ключ живости воркера: arq обновляет его сам, а `/api/health` по нему судит о воркере.
WORKER_HEALTH_KEY: Final[str] = f"{QUEUE_NAME}:health-check"

# Имя задачи расчёта в очереди. Идентификатором задачи служит сам `run_id`, поэтому
# повторная постановка того же запуска очередь не дублирует.
RUN_CALCULATION_TASK: Final[str] = "run_calculation"

# `05_API.md` §4: повторный POST с тем же ключом обязан вернуть тот же Run в течение суток.
IDEMPOTENCY_TTL_S: Final[int] = 24 * 60 * 60

# Флаг отмены живёт заведомо дольше самого расчёта, но не вечно: иначе отменённые запуски
# копились бы в Redis, а ключ пережил бы даже перезапуск варианта с тем же идентификатором.
CANCEL_TTL_S: Final[int] = 60 * 60


def run_channel(run_id: UUID) -> str:
    """Канал pub/sub с прогрессом одного запуска."""
    return f"run:{run_id}"


def cancel_key(run_id: UUID) -> str:
    """Флаг «расчёт отменён»: его видит колбэк прогресса внутри расчёта."""
    return f"run:{run_id}:cancel"


def idempotency_key(key: str) -> str:
    """Ключ `Idempotency-Key` → идентификатор ранее созданного запуска."""
    return f"idem:{key}"
