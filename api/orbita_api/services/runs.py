"""Запуск расчёта: постановка в очередь, переиспользование, прогресс и отмена.

Расчёт здесь не выполняется ни при каких условиях: сервис только решает, нужен ли новый
Run, и передаёт его воркеру. Единственное обращение к ядру — `config_hash`, то есть
хэширование канонического сценария, без которого нельзя ответить, считалось ли это уже
(ADR-011).
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from orbita_core import ENGINE_VERSION
from orbita_worker.keys import run_channel
from redis.asyncio.client import PubSub
from redis.exceptions import RedisError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orbita_api.db import models
from orbita_api.error_handling import (
    EntityNotFoundError,
    IdempotencyConflictError,
    RunNotCancellableError,
)
from orbita_api.repositories import JobRepository, RunRepository, VariantRepository
from orbita_api.runtime import IdempotencyRecord, RunRuntime
from orbita_api.schemas.common import TERMINAL_RUN_STATUSES, RunStage, RunStatus
from orbita_api.schemas.runs import Run, RunCreateRequest, RunProgressEvent
from orbita_api.services import scenarios, serialization
from orbita_api.services.variants import VARIANT_ENTITY

logger = logging.getLogger(__name__)

RUN_ENTITY: Final[str] = "Запуск"

# Сколько ждать сообщение из канала прогресса за один шаг цикла. Значение видно только в
# задержке закрытия потока после отключения клиента.
_MESSAGE_TIMEOUT_S: Final[float] = 1.0

# Раз в столько секунд тишины состояние перечитывается из Postgres: сообщение могло не
# дойти, а поток обязан закрыться на завершённом запуске, а не висеть вечно.
_STATE_RECHECK_S: Final[float] = 5.0

# Шаг опроса, когда Redis недоступен (`06_STORAGE.md` §7).
_POLL_INTERVAL_S: Final[float] = 1.0


@dataclass(frozen=True, slots=True)
class RunSubmission:
    """Ответ на `POST /api/runs`: сам Run и то, как он получен."""

    run: Run
    created: bool
    degraded: bool


async def submit_run(
    session: AsyncSession,
    runtime: RunRuntime,
    request: RunCreateRequest,
    idempotency_key: str | None,
) -> RunSubmission:
    """Ставит расчёт в очередь либо возвращает тот, который уже отвечает на этот вопрос."""
    variant = await VariantRepository(session).get(request.variant_id)
    if variant is None:
        raise EntityNotFoundError(VARIANT_ENTITY, request.variant_id)

    repository = RunRepository(session)
    fingerprint = _fingerprint(request)
    if idempotency_key is not None:
        remembered = await _run_by_idempotency_key(
            repository,
            runtime,
            idempotency_key,
            fingerprint,
        )
        if remembered is not None:
            return RunSubmission(serialization.to_run(remembered), created=False, degraded=False)

    scenario = scenarios.parse_stored(variant.scenario)
    config_hash = scenarios.run_config_hash(scenario, str(request.routing_policy))

    reusable = await repository.find_active(config_hash, ENGINE_VERSION)
    if reusable is not None:
        await _remember(runtime, idempotency_key, reusable.id, fingerprint)
        return RunSubmission(serialization.to_run(reusable), created=False, degraded=False)

    run = models.Run(
        variant_id=variant.id,
        routing_policy=request.routing_policy,
        engine_version=ENGINE_VERSION,
        config_hash=config_hash,
        status=RunStatus.QUEUED,
        stage=RunStage.VALIDATE,
        progress=0.0,
        completed_ticks=0,
        total_ticks=scenario.ticks,
    )
    repository.add(run)
    JobRepository(session).enqueue_run(run.id)
    try:
        await session.commit()
    except IntegrityError:
        # Частичный уникальный индекс `runs(config_hash, engine_version)` сработал:
        # такой же расчёт успел появиться между поиском и вставкой.
        await session.rollback()
        concurrent = await repository.find_active(config_hash, ENGINE_VERSION)
        if concurrent is None:
            raise
        return RunSubmission(serialization.to_run(concurrent), created=False, degraded=False)

    enqueued = await runtime.submit(run.id)
    await _remember(runtime, idempotency_key, run.id, fingerprint)
    return RunSubmission(serialization.to_run(run), created=True, degraded=not enqueued)


async def get_run(session: AsyncSession, run_id: UUID) -> Run:
    return serialization.to_run(await require_run(session, run_id))


async def cancel_run(session: AsyncSession, runtime: RunRuntime, run_id: UUID) -> Run:
    """Просит прервать расчёт.

    Стоящий в очереди запуск отменяется здесь же: задача до воркера ещё не дошла, а ждать
    её ради смены статуса незачем. Идущий расчёт прерывает сам воркер — он один знает,
    на какой стадии остановился, — поэтому ответ возвращает `running`, а конечный статус
    приходит событием прогресса.
    """
    run = await require_run(session, run_id)
    if run.status in TERMINAL_RUN_STATUSES:
        raise RunNotCancellableError(run_id, str(run.status))

    await runtime.request_cancel(run_id)
    if run.status == RunStatus.QUEUED:
        now = datetime.now(UTC)
        run.status = RunStatus.CANCELLED
        run.finished_at = now
        job = await JobRepository(session).find_for_run(run_id)
        if job is not None:
            job.status = RunStatus.CANCELLED
            job.finished_at = now
        await session.commit()
        await runtime.publish(_event_of(run))
    return serialization.to_run(run)


async def stream_progress(runtime: RunRuntime, run_id: UUID) -> AsyncIterator[RunProgressEvent]:
    """События прогресса: текущее состояние, затем канал `run:{id}` (`05_API.md` §4).

    Первым уходит состояние из Postgres — клиент, подключившийся к уже идущему расчёту,
    обязан увидеть стадию сразу, а не ждать следующего события воркера.
    """
    current = await _current_event(runtime.sessionmaker, run_id)
    if current is None:
        return
    yield current
    if current.status in TERMINAL_RUN_STATUSES:
        return

    pubsub = runtime.redis.pubsub()
    try:
        await pubsub.subscribe(run_channel(run_id))
    except RedisError as error:
        logger.warning("Канал прогресса %s недоступен, переходим на опрос: %s", run_id, error)
        async for event in _poll_progress(runtime.sessionmaker, run_id, current):
            yield event
        return

    try:
        # Расчёт мог закончиться между чтением состояния и подпиской: тогда ни одного
        # сообщения больше не будет, и поток обязан закрыться сам.
        latest = await _current_event(runtime.sessionmaker, run_id)
        if latest is None:
            return
        if latest != current:
            yield latest
            current = latest
        if latest.status in TERMINAL_RUN_STATUSES:
            return
        async for event in _read_channel(pubsub, runtime.sessionmaker, run_id, current):
            yield event
    finally:
        await _close(pubsub)


async def require_run(session: AsyncSession, run_id: UUID) -> models.Run:
    run = await RunRepository(session).get(run_id)
    if run is None:
        raise EntityNotFoundError(RUN_ENTITY, run_id)
    return run


async def _read_channel(
    pubsub: PubSub,
    sessionmaker: async_sessionmaker[AsyncSession],
    run_id: UUID,
    current: RunProgressEvent,
) -> AsyncIterator[RunProgressEvent]:
    silence_s = 0.0
    while True:
        try:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=_MESSAGE_TIMEOUT_S,
            )
        except RedisError as error:
            logger.warning("Канал прогресса %s оборвался, переходим на опрос: %s", run_id, error)
            async for event in _poll_progress(sessionmaker, run_id, current):
                yield event
            return

        if message is not None:
            silence_s = 0.0
            current = RunProgressEvent.model_validate_json(message["data"])
            yield current
            if current.status in TERMINAL_RUN_STATUSES:
                return
            continue

        silence_s += _MESSAGE_TIMEOUT_S
        if silence_s < _STATE_RECHECK_S:
            continue
        silence_s = 0.0
        latest = await _current_event(sessionmaker, run_id)
        if latest is None:
            return
        if latest != current:
            yield latest
            current = latest
        if latest.status in TERMINAL_RUN_STATUSES:
            return


async def _poll_progress(
    sessionmaker: async_sessionmaker[AsyncSession],
    run_id: UUID,
    current: RunProgressEvent,
) -> AsyncIterator[RunProgressEvent]:
    """Опрос Postgres вместо pub/sub: degraded mode, а не ошибка (`06_STORAGE.md` §7)."""
    while True:
        await asyncio.sleep(_POLL_INTERVAL_S)
        latest = await _current_event(sessionmaker, run_id)
        if latest is None:
            return
        if latest != current:
            yield latest
            current = latest
        if latest.status in TERMINAL_RUN_STATUSES:
            return


async def _current_event(
    sessionmaker: async_sessionmaker[AsyncSession],
    run_id: UUID,
) -> RunProgressEvent | None:
    """Состояние запуска отдельной короткой сессией: поток живёт дольше запроса."""
    async with sessionmaker() as session:
        run = await RunRepository(session).get(run_id)
        if run is None:
            return None
        return _event_of(run)


def _event_of(run: models.Run) -> RunProgressEvent:
    return RunProgressEvent(
        run_id=run.id,
        status=run.status,
        stage=run.stage,
        progress=run.progress,
        completed_ticks=run.completed_ticks,
        total_ticks=run.total_ticks,
    )


async def _run_by_idempotency_key(
    repository: RunRepository,
    runtime: RunRuntime,
    key: str,
    fingerprint: str,
) -> models.Run | None:
    """Запуск, созданный ранее под этим ключом (`05_API.md` §4)."""
    record = await runtime.read_idempotency(key)
    if record is None:
        return None
    if record.fingerprint != fingerprint:
        raise IdempotencyConflictError(key)
    # Ключ живёт сутки, а запуск мог быть удалён вместе с проектом: тогда ключ ничего не
    # обозначает, и запрос обрабатывается как первый.
    return await repository.get(record.run_id)


async def _remember(
    runtime: RunRuntime,
    key: str | None,
    run_id: UUID,
    fingerprint: str,
) -> None:
    if key is None:
        return
    record = IdempotencyRecord(run_id=run_id, fingerprint=fingerprint)
    await runtime.remember_idempotency(key, record)


def _fingerprint(request: RunCreateRequest) -> str:
    """Отпечаток запроса: по нему видно, что ключ повторили с другим телом."""
    return f"{request.variant_id}:{request.routing_policy}"


async def _close(pubsub: PubSub) -> None:
    """Закрытие подписки. Ошибка здесь ничего не меняет: поток уже отдан клиенту."""
    try:
        # `aclose` библиотеки не аннотирован, поэтому вызов обёрнут отдельной функцией:
        # так послабление типов ограничено одной строкой, а не всем сервисом.
        await pubsub.aclose()  # type: ignore[no-untyped-call]
    except RedisError as error:
        logger.warning("Подписка на канал прогресса закрыта с ошибкой: %s", error)
