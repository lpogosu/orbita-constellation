"""Расчёт одного Run: чтение сценария, вызов ядра, прогресс, отмена, запись результата.

Направление зависимостей: воркер импортирует модели и репозитории api
(`orbita_api.db`, `orbita_api.repositories`) — таблицы у процессов общие, и второй набор
моделей неизбежно разошёлся бы с первым. Обратный импорт из `orbita_api.services` сюда
запрещён: api вызывает отсюда только `execute_run`, чтобы выполнить расчёт в своём
процессе, когда Redis недоступен (`06_STORAGE.md` §7).

Ядро считает синхронно и держит GIL, поэтому расчёт уходит в отдельный поток: event loop
воркера обязан оставаться живым, иначе не сработают ни отметка живости, ни отмена.
"""

import asyncio
import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final, Protocol
from uuid import UUID

from orbita_api.db import models
from orbita_api.repositories import JobRepository, MetricsRepository, RunRepository
from orbita_api.schemas.common import TERMINAL_RUN_STATUSES, RunStage, RunStatus
from orbita_api.schemas.errors import ErrorCode
from orbita_api.schemas.runs import RunProgressEvent
from orbita_core import engine
from orbita_core.engine import ProgressCallback, RunResult
from orbita_core.engine import RunStage as CoreRunStage
from orbita_core.routing import InternalInconsistencyError, RoutingPolicy
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orbita_worker import persistence
from orbita_worker.artifacts import ArtifactSink, StoredArtifacts, metrics_only
from orbita_worker.events import RunEvents

logger = logging.getLogger(__name__)

# Стадия обновляется в Postgres при каждой смене, но не чаще этого интервала внутри одной
# стадии: строку `runs` читает опрос `GET /api/runs/{id}`, и запись на каждый отсчёт
# нагрузила бы базу ради цифр, которых глазом не различить.
PROGRESS_UPDATE_INTERVAL_S: Final[float] = 0.5

_STAGES: Final[tuple[RunStage, ...]] = tuple(RunStage)


class Calculation(Protocol):
    """Расчёт ядра. Отдельный тип нужен, чтобы тест мог подставить свою реализацию."""

    def __call__(
        self,
        scenario: Mapping[str, object],
        policy: RoutingPolicy,
        *,
        progress: ProgressCallback,
    ) -> RunResult: ...


class RunCancelledError(RuntimeError):
    """Расчёт прерван: колбэк прогресса увидел флаг отмены."""


async def execute_run(
    run_id: UUID,
    sessionmaker: async_sessionmaker[AsyncSession],
    events: RunEvents,
    *,
    calculate: Calculation = engine.run,
    artifacts: ArtifactSink = metrics_only,
) -> None:
    """Выполняет поставленный в очередь расчёт и записывает его результат.

    Ошибки расчёта не выпускаются наружу: они детерминированы, повтор дал бы то же самое,
    поэтому запуск помечается `failed` и задача считается выполненной. Ошибки хранилищ,
    наоборот, пробрасываются — их повторяет arq (`06_STORAGE.md` §7).
    """
    started = time.monotonic()
    prepared = await _start(run_id, sessionmaker, events)
    if prepared is None:
        return

    reporter = _ProgressReporter(
        run_id=run_id,
        sessionmaker=sessionmaker,
        events=events,
        loop=asyncio.get_running_loop(),
    )
    try:
        result = await asyncio.to_thread(
            calculate,
            prepared.scenario,
            prepared.policy,
            progress=reporter,
        )
    except RunCancelledError:
        await _finish(run_id, sessionmaker, events, RunStatus.CANCELLED, reporter.stage, started)
        return
    except Exception as error:
        logger.exception("Расчёт %s упал на стадии %s", run_id, reporter.stage)
        await _finish(
            run_id,
            sessionmaker,
            events,
            RunStatus.FAILED,
            reporter.stage,
            started,
            error=_error_payload(error, reporter.stage),
        )
        return

    await _store_result(run_id, sessionmaker, result)
    stored = await artifacts(run_id, result)
    await _finish(
        run_id,
        sessionmaker,
        events,
        RunStatus.SUCCEEDED,
        RunStage.COMPLETE,
        started,
        stored=stored,
        completed_ticks=prepared.total_ticks,
    )


@dataclass(frozen=True, slots=True)
class _PreparedRun:
    """Всё, что нужно расчёту, прочитанное до его начала."""

    scenario: Mapping[str, object]
    policy: RoutingPolicy
    total_ticks: int


async def _start(
    run_id: UUID,
    sessionmaker: async_sessionmaker[AsyncSession],
    events: RunEvents,
) -> _PreparedRun | None:
    """Переводит запуск в `running` и отдаёт сценарий. `None` — работать не над чем."""
    async with sessionmaker() as session:
        run = await RunRepository(session).get(run_id)
        if run is None:
            # Запуск удалён вместе с проектом, пока задача стояла в очереди.
            logger.warning("Запуск %s не найден, задача пропущена", run_id)
            return None

        job = await JobRepository(session).start_attempt(run_id)
        if run.status in TERMINAL_RUN_STATUSES:
            # Запуск успели отменить или посчитать: задача из очереди опоздала.
            logger.info("Запуск %s уже в состоянии %s, расчёт не нужен", run_id, run.status)
            job.status = run.status
            job.finished_at = datetime.now(UTC)
            await session.commit()
            return None

        if await events.is_cancelled(run_id):
            # Отмена пришла до того, как задачу взяли из очереди.
            _mark_cancelled(run, job)
            await session.commit()
            await events.publish(_event_of(run))
            return None

        variant = await session.get(models.Variant, run.variant_id)
        if variant is None:
            raise RuntimeError(f"Вариант {run.variant_id} запуска {run_id} исчез")

        now = datetime.now(UTC)
        run.status = RunStatus.RUNNING
        run.stage = RunStage.VALIDATE
        run.progress = _progress_of(RunStage.VALIDATE)
        run.started_at = now
        job.status = RunStatus.RUNNING
        job.started_at = now
        prepared = _PreparedRun(
            scenario=dict(variant.scenario),
            policy=RoutingPolicy(str(run.routing_policy)),
            total_ticks=run.total_ticks,
        )
        await session.commit()
        await events.publish(_event_of(run))
        return prepared


class _ProgressReporter:
    """Колбэк прогресса ядра, работающий из чужого потока.

    Ядро вызывает его синхронно внутри расчёта, а публикация события и запись в Postgres
    асинхронны, поэтому каждый вызов передаётся в event loop воркера и дожидается
    результата: без ожидания колбэк не смог бы узнать об отмене.
    """

    def __init__(
        self,
        run_id: UUID,
        sessionmaker: async_sessionmaker[AsyncSession],
        events: RunEvents,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        self._run_id = run_id
        self._sessionmaker = sessionmaker
        self._events = events
        self._loop = loop
        self._last_update = 0.0
        self.stage = RunStage.VALIDATE

    def __call__(self, stage: CoreRunStage, completed_ticks: int, total_ticks: int) -> None:
        # Общее число отсчётов уже лежит в строке `runs`: ядро повторяет его в каждом
        # вызове, а событие собирается из строки, поэтому третий аргумент здесь не нужен.
        future = asyncio.run_coroutine_threadsafe(
            self._report(RunStage(str(stage)), completed_ticks),
            self._loop,
        )
        future.result()

    async def _report(self, stage: RunStage, completed_ticks: int) -> None:
        if await self._events.is_cancelled(self._run_id):
            raise RunCancelledError(f"Расчёт {self._run_id} отменён на стадии {stage}")

        stage_changed = stage != self.stage
        self.stage = stage
        now = time.monotonic()
        if not stage_changed and now - self._last_update < PROGRESS_UPDATE_INTERVAL_S:
            return
        self._last_update = now

        async with self._sessionmaker() as session:
            run = await RunRepository(session).get(self._run_id)
            if run is None:
                raise RunCancelledError(f"Запуск {self._run_id} удалён во время расчёта")
            run.stage = stage
            run.completed_ticks = completed_ticks
            run.progress = _progress_of(stage)
            await session.commit()
            event = _event_of(run)
        await self._events.publish(event)


async def _store_result(
    run_id: UUID,
    sessionmaker: async_sessionmaker[AsyncSession],
    result: RunResult,
) -> None:
    """Метрики, метрики конфигурации и перерывы одной транзакцией (`06_STORAGE.md` §7)."""
    async with sessionmaker() as session:
        await MetricsRepository(session).replace_for_run(
            run_id,
            persistence.client_metric_rows(run_id, result.aggregate),
            persistence.config_metric_row(run_id, result.aggregate),
            persistence.outage_rows(run_id, result.aggregate),
        )
        await session.commit()


async def _finish(
    run_id: UUID,
    sessionmaker: async_sessionmaker[AsyncSession],
    events: RunEvents,
    status: RunStatus,
    stage: RunStage,
    started: float,
    *,
    error: dict[str, Any] | None = None,
    stored: StoredArtifacts | None = None,
    completed_ticks: int | None = None,
) -> None:
    """Закрывает запуск и его запись в журнале задач."""
    async with sessionmaker() as session:
        run = await RunRepository(session).get(run_id)
        if run is None:
            logger.warning("Запуск %s удалён до записи результата", run_id)
            return
        now = datetime.now(UTC)
        run.status = status
        run.stage = stage
        run.progress = _progress_of(stage)
        run.finished_at = now
        # Длительность считается по часам задачи, а не по времени внутри ядра: это то
        # время, которое ждал пользователь, включая запись результата.
        run.duration_ms = round((time.monotonic() - started) * 1000)
        run.error = error
        if completed_ticks is not None:
            run.completed_ticks = completed_ticks
        if stored is not None:
            run.degraded_mode = stored.degraded_mode
            if stored.trace_uri is not None:
                run.trace_uri = stored.trace_uri

        job = await JobRepository(session).find_for_run(run_id)
        if job is not None:
            job.status = status
            job.finished_at = now
            job.error = error
        await session.commit()
        event = _event_of(run)
    await events.publish(event)


def _mark_cancelled(run: models.Run, job: models.Job) -> None:
    now = datetime.now(UTC)
    run.status = RunStatus.CANCELLED
    run.finished_at = now
    job.status = RunStatus.CANCELLED
    job.finished_at = now


def _error_payload(error: Exception, stage: RunStage) -> dict[str, Any]:
    """Ошибка расчёта в конверте `05_API.md` §3.

    Стадия лежит в `details`, как требует `03_GLOSSARY.md` §3.6 для `RUN_FAILED`:
    отдельного поля у `ErrorDetail` нет, и заводить его ради одного кода незачем.
    """
    code = (
        ErrorCode.INTERNAL_INCONSISTENCY
        if isinstance(error, InternalInconsistencyError)
        else ErrorCode.RUN_FAILED
    )
    return {
        "code": str(code),
        "message": str(error) or error.__class__.__name__,
        "path": None,
        "details": {"stage": str(stage)},
    }


def _event_of(run: models.Run) -> RunProgressEvent:
    return RunProgressEvent(
        run_id=run.id,
        status=run.status,
        stage=run.stage,
        progress=run.progress,
        completed_ticks=run.completed_ticks,
        total_ticks=run.total_ticks,
    )


def _progress_of(stage: RunStage) -> float:
    """Доля выполненной работы по стадиям.

    Считать её по отсчётам нельзя: маршрутизация проходит всю сетку одним вызовом ядра и
    до своего конца сообщает ноль посчитанных отсчётов. Стадии же меняются наблюдаемо, и
    полоса прогресса по ним движется равномерно.
    """
    return _STAGES.index(stage) / (len(_STAGES) - 1)
