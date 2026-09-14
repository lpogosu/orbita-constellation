import os
from collections.abc import Callable
from typing import Any, ClassVar, Final

from arq.connections import RedisSettings
from orbita_api.adapters.registry import StorageRegistry, build_storage_registry
from orbita_api.db.session import build_engine, build_sessionmaker
from orbita_api.settings import get_settings
from sqlalchemy.ext.asyncio import AsyncEngine

from orbita_worker.jobs import WorkerContext, ping, run_calculation
from orbita_worker.keys import QUEUE_NAME, WORKER_HEALTH_KEY

# Раз в 10 секунд arq обновляет ключ живости и выставляет ему TTL чуть больше периода.
# Более редкая запись сделала бы `/api/health` слепым к падению воркера на минуты.
HEALTH_CHECK_INTERVAL_S: Final[int] = 10

# Столько же раз, сколько `06_STORAGE.md` §7 отводит на повтор задачи при сбое воркера.
# Ошибки расчёта до повтора не доходят: задача ловит их сама и помечает Run `failed`.
MAX_TRIES: Final[int] = 3

DEFAULT_REDIS_URL: Final[str] = "redis://redis:6379/0"


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(os.environ.get("ORBITA_REDIS_URL", DEFAULT_REDIS_URL))


async def on_startup(ctx: WorkerContext) -> None:
    """Пул соединений с Postgres и клиенты хранилищ на весь процесс воркера.

    Движок создаётся один раз: задача расчёта открывает по сессии на каждый короткий шаг
    (старт, прогресс, результат) и не держит соединение занятым во время расчёта. Клиенты
    MinIO и Memgraph живут столько же: соединение на каждую задачу стоило бы рукопожатия
    ради одной записи трассы.
    """
    engine = build_engine(get_settings().postgres_dsn)
    ctx["engine"] = engine
    ctx["sessionmaker"] = build_sessionmaker(engine)
    ctx["storage"] = build_storage_registry(get_settings())


async def on_shutdown(ctx: WorkerContext) -> None:
    storage = ctx.get("storage")
    if isinstance(storage, StorageRegistry):
        await storage.aclose()
    engine = ctx.get("engine")
    if isinstance(engine, AsyncEngine):
        await engine.dispose()


class WorkerSettings:
    """Конфигурация arq-воркера; запускается как `arq orbita_worker.settings.WorkerSettings`."""

    # arq читает атрибуты класса, экземпляр не создаётся: список функций
    # объявлен ClassVar, чтобы это было видно и линтеру, и читателю.
    functions: ClassVar[list[Callable[..., Any]]] = [ping, run_calculation]
    queue_name = QUEUE_NAME
    redis_settings = redis_settings()
    health_check_key = WORKER_HEALTH_KEY
    health_check_interval = HEALTH_CHECK_INTERVAL_S
    max_tries = MAX_TRIES
    on_startup = staticmethod(on_startup)
    on_shutdown = staticmethod(on_shutdown)
