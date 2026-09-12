"""Расчёт: preview, запуск суток, прогресс, снимки, метрики и выгрузка (`05_API.md` §2)."""

from typing import Annotated, Final
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette import EventSourceResponse, ServerSentEvent

from orbita_api.db.session import get_session
from orbita_api.error_handling import EndpointNotImplementedError
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
from orbita_api.services import runs

router = APIRouter(tags=["runs"])

TickQuery = Annotated[int, Query(ge=0, description="Отсчёт сетки, секунды от начала расчёта")]
Session = Annotated[AsyncSession, Depends(get_session)]
Runtime = Annotated[RunRuntime, Depends(get_runtime)]

# Заголовок ответа `POST /api/runs`: расчёт выполняется в процессе api, потому что Redis
# недоступен (`06_STORAGE.md` §7). В теле Run такого поля контракт не предусматривает.
DEGRADED_MODE_HEADER: Final[str] = "X-Degraded-Mode"

# Комментарий-heartbeat в поток SSE: прокси и балансировщики рвут соединение, в котором
# долго ничего не происходит, а расчёт может молчать между стадиями.
HEARTBEAT_INTERVAL_S: float = 15.0

# Имя события SSE. Единственное на весь поток: клиент разбирает `data` как RunProgressEvent.
PROGRESS_EVENT: Final[str] = "progress"


class RunEventsResponse(EventSourceResponse):
    """SSE-ответ с типом содержимого на уровне класса.

    `EventSourceResponse` проставляет `media_type` только экземпляру, а генератору
    OpenAPI нужен атрибут класса: без него поток попал бы в схему без типа содержимого.
    """

    media_type = "text/event-stream"


@router.post(
    "/preview",
    summary="Снимок одного отсчёта для несохранённого draft",
    responses=error_responses(400, 501, 503),
)
async def preview_snapshot(request: PreviewRequest) -> Snapshot:
    """Считает один отсчёт без создания варианта и запуска.

    Нужен левой панели экрана «Сеть»: пользователь двигает RAAN и сразу видит результат,
    не заводя вариант на каждое движение ползунка.
    """
    raise EndpointNotImplementedError


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
    responses=error_responses(400, 404, 501, 503),
)
async def get_run_snapshot(run_id: UUID, t_s: TickQuery) -> Snapshot:
    """Восстанавливает снимок из трассы и сценария: координаты не хранятся (ADR-010)."""
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/timeline",
    summary="Доступность и причины по отсчётам для каждого клиента",
    responses=error_responses(404, 501, 503),
)
async def get_run_timeline(run_id: UUID) -> RunTimeline:
    """Данные нижней шкалы экрана «Сеть» за один запрос."""
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/metrics",
    summary="Показатели клиентов и конфигурации",
    responses=error_responses(404, 501, 503),
)
async def get_run_metrics(run_id: UUID) -> RunMetrics:
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/outages",
    summary="Интервалы без связи с причинами",
    responses=error_responses(404, 501, 503),
)
async def get_run_outages(run_id: UUID) -> list[OutageInterval]:
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/backup-paths",
    summary="Резервные маршруты и минимальный разрез на отсчёте",
    responses=error_responses(400, 404, 501, 503),
)
async def get_run_backup_paths(
    run_id: UUID,
    t_s: TickQuery,
    client_id: Annotated[str, Query(description="Идентификатор клиентского пункта из сценария")],
) -> BackupPaths:
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/export",
    summary="Выгрузка результата cosmo-A-result-1.0",
    responses=error_responses(404, 501, 503),
)
async def export_run(run_id: UUID) -> RunExport:
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/evidence-pack",
    summary="Архив с выгрузкой, метриками, перерывами, сравнением и рекомендацией",
    response_class=Response,
    responses={
        200: {
            "description": "zip-архив Evidence Pack",
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        },
        **error_responses(404, 501, 503),
    },
)
async def get_run_evidence_pack(run_id: UUID) -> Response:
    """Отдаёт zip: всё, чем расчёт подтверждается на защите, одним файлом."""
    raise EndpointNotImplementedError
