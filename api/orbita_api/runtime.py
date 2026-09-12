"""Очередь расчётов, ключ идемпотентности и запасной расчёт в процессе api.

Здесь собрано всё, что api делает с Redis по поводу запусков: ставит задачу, помнит
`Idempotency-Key`, просит отмену. Имена ключей приходят из `orbita_worker.keys` — они
общие с воркером, — а сам расчёт вызывается отсюда только в degraded mode, когда Redis
недоступен и очереди не существует (`06_STORAGE.md` §7).
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from arq.connections import ArqRedis
from fastapi import Request
from orbita_worker.events import LocalRunEvents, RedisRunEvents
from orbita_worker.keys import (
    IDEMPOTENCY_TTL_S,
    QUEUE_NAME,
    RUN_CALCULATION_TASK,
    idempotency_key,
)
from orbita_worker.runner import execute_run
from redis.asyncio import ConnectionPool
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orbita_api.schemas.runs import RunProgressEvent
from orbita_api.settings import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class IdempotencyRecord:
    """Что было создано под ключом `Idempotency-Key`.

    Вместе с идентификатором запуска хранится отпечаток запроса: тот же ключ с другим
    телом — это ошибка клиента, а не повтор, и отвечать на него первым запуском нельзя.
    """

    run_id: UUID
    fingerprint: str

    def to_json(self) -> str:
        return json.dumps({"run_id": str(self.run_id), "fingerprint": self.fingerprint})

    @classmethod
    def from_json(cls, raw: bytes | str) -> "IdempotencyRecord":
        payload: dict[str, Any] = json.loads(raw)
        return cls(run_id=UUID(payload["run_id"]), fingerprint=str(payload["fingerprint"]))


class RunRuntime:
    """Один на процесс api: клиент Redis, фабрика сессий и фоновые расчёты."""

    def __init__(self, redis: ArqRedis, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._redis = redis
        self._sessionmaker = sessionmaker
        # Отмена расчётов, запущенных прямо здесь: до них флаг в Redis не дойдёт, потому
        # что в degraded mode Redis и нет.
        self._local_events = LocalRunEvents()
        # Ссылки на фоновые задачи: без них сборщик мусора вправе убить работающий расчёт.
        self._background: set[asyncio.Task[None]] = set()

    @property
    def redis(self) -> ArqRedis:
        return self._redis

    @property
    def sessionmaker(self) -> async_sessionmaker[AsyncSession]:
        return self._sessionmaker

    async def submit(self, run_id: UUID) -> bool:
        """Ставит расчёт в очередь. `False` — Redis недоступен, считаем в процессе api.

        Идентификатором задачи служит сам `run_id`: повторная постановка того же запуска
        не создаёт второй задачи, даже если запрос пришёл дважды.
        """
        try:
            await self._redis.enqueue_job(
                RUN_CALCULATION_TASK,
                str(run_id),
                _job_id=str(run_id),
                _queue_name=QUEUE_NAME,
            )
        except RedisError as error:
            logger.warning("Очередь недоступна, расчёт %s идёт в процессе api: %s", run_id, error)
            self._start_in_process(run_id)
            return False
        return True

    async def read_idempotency(self, key: str) -> IdempotencyRecord | None:
        """Что уже создано под этим ключом. `None` — ключ свободен или Redis недоступен."""
        try:
            stored = await self._redis.get(idempotency_key(key))
        except RedisError as error:
            logger.warning("Ключ идемпотентности %s не прочитан: %s", key, error)
            return None
        if stored is None:
            return None
        return IdempotencyRecord.from_json(stored)

    async def remember_idempotency(self, key: str, record: IdempotencyRecord) -> None:
        """Запоминает ключ на сутки (`05_API.md` §4).

        Запись идёт только если ключ свободен: выиграл тот запрос, который дошёл первым,
        а проигравший всё равно найдёт его запуск по `config_hash` (ADR-011).
        """
        try:
            await self._redis.set(
                idempotency_key(key),
                record.to_json(),
                nx=True,
                ex=IDEMPOTENCY_TTL_S,
            )
        except RedisError as error:
            logger.warning("Ключ идемпотентности %s не сохранён: %s", key, error)

    async def publish(self, event: RunProgressEvent) -> None:
        """Рассылает состояние подписчикам потока событий.

        Нужно там, где состояние меняет сам api, а не воркер: отменённый в очереди запуск
        обязан закрыть поток сразу, а не через опрос Postgres.
        """
        try:
            await RedisRunEvents(self._redis).publish(event)
        except RedisError as error:
            logger.warning("Событие запуска %s не опубликовано: %s", event.run_id, error)

    async def request_cancel(self, run_id: UUID) -> None:
        """Просит прервать расчёт.

        Флаг ставится в обоих каналах: расчёт мог уйти и в воркер через Redis, и в этот
        процесс, если в момент постановки очередь была недоступна.
        """
        await self._local_events.request_cancel(run_id)
        try:
            await RedisRunEvents(self._redis).request_cancel(run_id)
        except RedisError as error:
            logger.warning("Флаг отмены запуска %s не записан в Redis: %s", run_id, error)

    async def aclose(self) -> None:
        for task in tuple(self._background):
            task.cancel()
        await self._redis.aclose()

    def _start_in_process(self, run_id: UUID) -> None:
        task = asyncio.create_task(
            execute_run(run_id, self._sessionmaker, self._local_events),
            name=f"run-{run_id}",
        )
        self._background.add(task)
        task.add_done_callback(self._forget_background)

    def _forget_background(self, task: asyncio.Task[None]) -> None:
        self._background.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            logger.error("Расчёт в процессе api завершился ошибкой: %s", error)


def build_runtime(settings: Settings, sessionmaker: async_sessionmaker[AsyncSession]) -> RunRuntime:
    """Клиент очереди без подключения к Redis.

    Пул создаётся отдельно от клиента: `ArqRedis.from_url` передал бы свои параметры
    очереди в конструктор соединения, а имя очереди — не его дело. Сеть при этом не
    трогается: соединение открывается первой командой, и api поднимается даже с
    выключенным Redis, как того требует degraded mode.

    Таймауты обязательны: без них недоступный Redis держал бы обработчик запроса минуты
    вместо мгновенного перехода в degraded mode.
    """
    pool = ConnectionPool.from_url(
        settings.redis_url,
        socket_connect_timeout=settings.probe_timeout_s,
        socket_timeout=settings.probe_timeout_s,
        retry_on_timeout=False,
    )
    return RunRuntime(ArqRedis(pool, default_queue_name=QUEUE_NAME), sessionmaker)


def get_runtime(request: Request) -> RunRuntime:
    """Зависимость FastAPI; создаётся один раз в lifespan."""
    runtime = request.app.state.run_runtime
    if not isinstance(runtime, RunRuntime):
        raise RuntimeError("Очередь расчётов не инициализирована")
    return runtime
