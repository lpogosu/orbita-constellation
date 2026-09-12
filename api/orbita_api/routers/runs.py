"""Расчёт: preview, запуск суток, прогресс, снимки, метрики и выгрузка (`05_API.md` §2)."""

from typing import Annotated, Final
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette import EventSourceResponse, ServerSentEvent

from orbita_api.adapters.registry import StorageRegistry, get_storage_registry
from orbita_api.db.session import get_session
from orbita_api.runtime import RunRuntime, get_runtime
from orbita_api.schemas.errors import error_responses
from orbita_api.schemas.results import OutageInterval, RunExport, RunMetrics
from orbita_api.schemas.runs import (
    BackupPaths,
    PreviewRequest,
    Run,
    RunCreateRequest,
    RunProgressEvent,
    RunTimeline,
    Snapshot,
)
from orbita_api.services import evidence, preview, results, runs

router = APIRouter(tags=["runs"])

TickQuery = Annotated[int, Query(ge=0, description="Отсчёт сетки, секунды от начала расчёта")]
Session = Annotated[AsyncSession, Depends(get_session)]
Runtime = Annotated[RunRuntime, Depends(get_runtime)]
Storage = Annotated[StorageRegistry, Depends(get_storage_registry)]

# Заголовок ответа `POST /api/runs`: расчёт выполняется в процессе api, потому что Redis
# недоступен (`06_STORAGE.md` §7). В теле Run такого поля контракт не предусматривает.
DEGRADED_MODE_HEADER: Final[str] = "X-Degraded-Mode"

# Комментарий-heartbeat в поток SSE: прокси и балансировщики рвут соединение, в котором
# долго ничего не происходит, а расчёт может молчать между стадиями.
HEARTBEAT_INTERVAL_S: float = 15.0

# Имя события SSE. Единственное на весь поток: клиент разбирает `data` как RunProgressEvent.
PROGRESS_EVENT: Final[str] = "progress"

# Имя файла выгрузки и архива: браузер сохранит ответ под ним, и по имени видно, к какому
# запуску относится файл, лежащий в папке загрузок рядом с десятком таких же.
CONTENT_DISPOSITION: Final[str] = "Content-Disposition"
EXPORT_FILENAME: Final[str] = "orbita-run-{run_id}.json"
EVIDENCE_FILENAME: Final[str] = "orbita-evidence-{run_id}.zip"


def _attachment(filename: str) -> dict[str, str]:
    return {CONTENT_DISPOSITION: f'attachment; filename="{filename}"'}


class RunEventsResponse(EventSourceResponse):
    """SSE-ответ с типом содержимого на уровне класса.

    `EventSourceResponse` проставляет `media_type` только экземпляру, а генератору
    OpenAPI нужен атрибут класса: без него поток попал бы в схему без типа содержимого.
    """

    media_type = "text/event-stream"


@router.post(
    "/preview",
    summary="Снимок одного отсчёта для несохранённого draft",
    responses=error_responses(400, 503),
)
async def preview_snapshot(request: PreviewRequest, runtime: Runtime) -> Snapshot:
    """Считает один отсчёт без создания варианта и запуска.

    Нужен левой панели экрана «Сеть»: пользователь двигает RAAN и сразу видит результат,
    не заводя вариант на каждое движение ползунка.
    """
    return await preview.preview(runtime, request)


@router.post(
    "/runs",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Запустить расчёт суток",
    responses={
        200: {
            "model": Run,
            "description": (
                "Расчёт не понадобился: вернулся готовый или уже идущий Run с тем же "
                "config_hash и engine_version (ADR-011) либо Run того же Idempotency-Key"
            ),
        },
        **error_responses(400, 404, 409, 503),
    },
)
async def create_run(
    request: RunCreateRequest,
    session: Session,
    runtime: Runtime,
    response: Response,
    idempotency_key: Annotated[
        str | None,
        Header(
            alias="Idempotency-Key",
            description="Повторный запрос с тем же ключом возвращает тот же Run (TTL 24 ч)",
        ),
    ] = None,
) -> Run:
    """Ставит расчёт в очередь и возвращает Run со статусом `queued`.

    Готовый Run переиспользуется при совпадении `config_hash` и `engine_version`
    (ADR-011), поэтому повторный запуск той же конфигурации не занимает воркер: в этом
    случае ответ 200, а не 202.

    Если очередь недоступна, расчёт идёт в процессе api, и ответ помечается заголовком
    `X-Degraded-Mode` (`06_STORAGE.md` §7).
    """
    submission = await runs.submit_run(session, runtime, request, idempotency_key)
    if not submission.created:
        response.status_code = status.HTTP_200_OK
    if submission.degraded:
        response.headers[DEGRADED_MODE_HEADER] = "true"
    return submission.run


@router.get(
    "/runs/{run_id}",
    summary="Статус, стадия и прогресс запуска",
    responses=error_responses(404, 503),
)
async def get_run(run_id: UUID, session: Session) -> Run:
    """Запасной путь к прогрессу, когда SSE недоступен (`05_API.md` §4)."""
    return await runs.get_run(session, run_id)


@router.get(
    "/runs/{run_id}/events",
    summary="Поток прогресса расчёта (SSE)",
    response_class=RunEventsResponse,
    response_model=RunProgressEvent,
    responses=error_responses(404, 503),
)
async def stream_run_events(
    run_id: UUID,
    session: Session,
    runtime: Runtime,
) -> RunEventsResponse:
    """Транслирует прогресс воркера из Redis-канала `run:{id}` как поток SSE-событий.

    Тело ответа - поток, поэтому в схеме оно строкой; поле `data` каждого события
    разбирается как `RunProgressEvent`. Поток закрывается, когда запуск перешёл в
    конечный статус.

    Состояние запуска проверяется до открытия потока: несуществующий запуск обязан дать
    404, а не пустой поток с кодом 200.
    """
    await runs.require_run(session, run_id)
    events = (
        ServerSentEvent(event=PROGRESS_EVENT, data=event.model_dump_json())
        async for event in runs.stream_progress(runtime, run_id)
    )
    return RunEventsResponse(events, ping=HEARTBEAT_INTERVAL_S)


@router.post(
    "/runs/{run_id}/cancel",
    summary="Отменить расчёт",
    responses=error_responses(404, 409, 503),
)
async def cancel_run(run_id: UUID, session: Session, runtime: Runtime) -> Run:
    """Ставит флаг отмены; завершённый запуск отменить нельзя и даёт 409."""
    return await runs.cancel_run(session, runtime, run_id)


@router.get(
    "/runs/{run_id}/snapshot",
    summary="Состояние сети на отсчёте",
    responses=error_responses(400, 404, 503),
)
async def get_run_snapshot(
    run_id: UUID,
    t_s: TickQuery,
    session: Session,
    storage: Storage,
) -> Snapshot:
    """Восстанавливает снимок из трассы и сценария: координаты не хранятся (ADR-010)."""
    return await results.run_snapshot(session, storage, run_id, t_s)


@router.get(
    "/runs/{run_id}/timeline",
    summary="Доступность и причины по отсчётам для каждого клиента",
    responses=error_responses(400, 404, 503),
)
async def get_run_timeline(run_id: UUID, session: Session, storage: Storage) -> RunTimeline:
    """Данные нижней шкалы экрана «Сеть» за один запрос."""
    return await results.run_timeline(session, storage, run_id)


@router.get(
    "/runs/{run_id}/metrics",
    summary="Показатели клиентов и конфигурации",
    responses=error_responses(400, 404, 503),
)
async def get_run_metrics(run_id: UUID, session: Session) -> RunMetrics:
    """Агрегаты читаются из Postgres: пересчитывать их нечем и незачем."""
    return await results.run_metrics(session, run_id)


@router.get(
    "/runs/{run_id}/outages",
    summary="Интервалы без связи с причинами",
    responses=error_responses(400, 404, 503),
)
async def get_run_outages(run_id: UUID, session: Session) -> list[OutageInterval]:
    """Перерывы вместе с доказательствами причины, записанными расчётом (ADR-005)."""
    return await results.run_outages(session, run_id)


@router.get(
    "/runs/{run_id}/backup-paths",
    summary="Резервные маршруты и минимальный разрез на отсчёте",
    responses=error_responses(400, 404, 503),
)
async def get_run_backup_paths(
    run_id: UUID,
    t_s: TickQuery,
    client_id: Annotated[str, Query(description="Идентификатор клиентского пункта из сценария")],
    session: Session,
    storage: Storage,
) -> BackupPaths:
    """Сколько независимых маршрутов есть у клиента и без каких аппаратов их не станет."""
    return await results.run_backup_paths(session, storage, run_id, t_s, client_id)


@router.get(
    "/runs/{run_id}/export",
    summary="Выгрузка результата cosmo-A-result-1.0",
    response_class=Response,
    responses={
        200: {
            "model": RunExport,
            "description": "Файл выгрузки результата",
        },
        **error_responses(400, 404, 503),
    },
)
async def export_run(run_id: UUID, session: Session, storage: Storage) -> Response:
    """Отдаёт сохранённый артефакт запуска байт в байт.

    Файл собран тем же расчётом, что и метрики, и лежит в хранилище. Пересборка на каждый
    запрос давала бы тот же результат ровно до смены версии ядра, а выгрузка обязана
    оставаться той, по которой метрики получены (инвариант 10 `10_FIXTURES.md` §2).
    """
    document = await results.run_export(session, storage, run_id)
    return Response(
        content=document,
        media_type="application/json",
        headers=_attachment(EXPORT_FILENAME.format(run_id=run_id)),
    )


@router.get(
    "/runs/{run_id}/evidence-pack",
    summary="Архив с выгрузкой, метриками, перерывами, сравнением и рекомендацией",
    response_class=Response,
    responses={
        200: {
            "description": "zip-архив Evidence Pack",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        },
        **error_responses(400, 404, 503),
    },
)
async def get_run_evidence_pack(
    run_id: UUID,
    session: Session,
    storage: Storage,
    base_run_id: Annotated[
        UUID | None,
        Query(description="Запуск для сравнения; без него архив идёт без сравнения и вывода"),
    ] = None,
) -> Response:
    """Отдаёт zip: всё, чем расчёт подтверждается на защите, одним файлом."""
    archive = await evidence.build(session, storage, run_id, base_run_id)
    return Response(
        content=archive,
        media_type="application/zip",
        headers=_attachment(EVIDENCE_FILENAME.format(run_id=run_id)),
    )
