"""Расчёт: preview, запуск суток, прогресс, снимки, метрики и выгрузка (`05_API.md` §2)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status
from sse_starlette.sse import EventSourceResponse

from orbita_api.error_handling import EndpointNotImplementedError
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

router = APIRouter(tags=["runs"])

TickQuery = Annotated[int, Query(ge=0, description="Отсчёт сетки, секунды от начала расчёта")]


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
    responses=error_responses(400, 404, 409, 501, 503),
)
async def create_run(
    request: RunCreateRequest,
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
    (ADR-011), поэтому повторный запуск той же конфигурации не занимает воркер.
    """
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}",
    summary="Статус, стадия и прогресс запуска",
    responses=error_responses(404, 501, 503),
)
async def get_run(run_id: UUID) -> Run:
    """Запасной путь к прогрессу, когда SSE недоступен (`05_API.md` §4)."""
    raise EndpointNotImplementedError


@router.get(
    "/runs/{run_id}/events",
    summary="Поток прогресса расчёта (SSE)",
    response_class=RunEventsResponse,
    responses=error_responses(404, 501, 503),
)
async def stream_run_events(run_id: UUID) -> RunProgressEvent:
    """Транслирует прогресс воркера из Redis-канала `run:{id}` как поток SSE-событий.

    Тело ответа - поток, поэтому в схеме оно строкой; поле `data` каждого события
    разбирается как `RunProgressEvent`. Поток закрывается, когда запуск перешёл в
    конечный статус.
    """
    raise EndpointNotImplementedError


@router.post(
    "/runs/{run_id}/cancel",
    summary="Отменить расчёт",
    responses=error_responses(404, 501, 503),
)
async def cancel_run(run_id: UUID) -> Run:
    raise EndpointNotImplementedError


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
    client_id: Annotated[str, Query(description="Клиентский пункт из сценария, например C65")],
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
