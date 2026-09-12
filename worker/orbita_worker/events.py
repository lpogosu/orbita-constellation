"""Прогресс и отмена расчёта: канал `run:{id}` и флаг `run:{id}:cancel`.

Расчёт идёт в воркере, а смотрит на него браузер, подключённый к api, поэтому прогресс
передаётся через Redis (`06_STORAGE.md` §5), а не возвращается из задачи. Отмена идёт в
обратную сторону тем же путём: api ставит флаг, колбэк прогресса его читает.

Реализаций две, потому что обязательный расчёт обязан работать и без Redis
(`06_STORAGE.md` §7): в degraded mode задача выполняется в процессе api, и канал ей не
нужен - прогресс виден в строке `runs`.
"""

from typing import Protocol
from uuid import UUID

from orbita_api.schemas.runs import RunProgressEvent
from redis.asyncio import Redis

from orbita_worker.keys import CANCEL_TTL_S, cancel_key, run_channel

# Значение флага отмены не несёт смысла: важен сам факт существования ключа.
_CANCEL_FLAG: bytes = b"1"


class RunEvents(Protocol):
    """Канал прогресса и флаг отмены одного запуска."""

    async def publish(self, event: RunProgressEvent) -> None: ...

    async def request_cancel(self, run_id: UUID) -> None: ...

    async def is_cancelled(self, run_id: UUID) -> bool: ...


class RedisRunEvents:
    """Прогресс через pub/sub Redis, отмена через ключ с ограниченным временем жизни."""

    def __init__(self, client: Redis) -> None:
        self._client = client

    async def publish(self, event: RunProgressEvent) -> None:
        """Отправляет событие подписчикам канала.

        Событие никуда не сохраняется: подписчик, подключившийся позже, берёт текущее
        состояние из Postgres, а хранить историю прогресса незачем.
        """
        await self._client.publish(run_channel(event.run_id), event.model_dump_json())

    async def request_cancel(self, run_id: UUID) -> None:
        await self._client.set(cancel_key(run_id), _CANCEL_FLAG, ex=CANCEL_TTL_S)

    async def is_cancelled(self, run_id: UUID) -> bool:
        return bool(await self._client.exists(cancel_key(run_id)))


class LocalRunEvents:
    """Отмена в пределах одного процесса: degraded mode без Redis.

    Подписчиков у канала в этом режиме нет по определению - расчёт и SSE живут в одном
    процессе api, и поток прогресса опрашивает Postgres, - поэтому публикация ничего не
    делает, а отмена хранится в памяти процесса, который этот расчёт и выполняет.
    """

    def __init__(self) -> None:
        self._cancelled: set[UUID] = set()

    async def publish(self, event: RunProgressEvent) -> None:
        return None

    async def request_cancel(self, run_id: UUID) -> None:
        self._cancelled.add(run_id)

    async def is_cancelled(self, run_id: UUID) -> bool:
        return run_id in self._cancelled
