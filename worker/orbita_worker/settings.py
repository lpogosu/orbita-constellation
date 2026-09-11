import os
from collections.abc import Callable
from typing import Any, ClassVar, Final

from arq.connections import RedisSettings

from orbita_worker.jobs import ping

QUEUE_NAME: Final[str] = "arq:queue"

# Ключ живости воркера. Значение дублируется в настройках api
# (`ORBITA_WORKER_HEALTH_KEY`, api/orbita_api/settings.py): api не импортирует пакет
# воркера, поэтому имя ключа — часть контракта очереди и меняется в двух местах сразу.
WORKER_HEALTH_KEY: Final[str] = f"{QUEUE_NAME}:health-check"

# Раз в 10 секунд arq обновляет ключ живости и выставляет ему TTL чуть больше периода.
# Более редкая запись сделала бы `/api/health` слепым к падению воркера на минуты.
HEALTH_CHECK_INTERVAL_S: Final[int] = 10

DEFAULT_REDIS_URL: Final[str] = "redis://redis:6379/0"


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(os.environ.get("ORBITA_REDIS_URL", DEFAULT_REDIS_URL))


class WorkerSettings:
    """Конфигурация arq-воркера; запускается как `arq orbita_worker.settings.WorkerSettings`."""

    # arq читает атрибуты класса, экземпляр не создаётся: список функций
    # объявлен ClassVar, чтобы это было видно и линтеру, и читателю.
    functions: ClassVar[list[Callable[..., Any]]] = [ping]
    queue_name = QUEUE_NAME
    redis_settings = redis_settings()
    health_check_key = WORKER_HEALTH_KEY
    health_check_interval = HEALTH_CHECK_INTERVAL_S
