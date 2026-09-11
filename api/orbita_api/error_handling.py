"""Перевод исключений в конверт ошибок `05_API.md` §3.

Обработчики регистрируются в `create_app`: тогда формат ошибки один на весь сервис и не
зависит от того, какой роутер её вызвал.
"""

from typing import Any, Final, cast

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from orbita_api.schemas.errors import (
    NOT_IMPLEMENTED_CODE,
    ErrorCode,
    ErrorDetail,
    ErrorResponse,
    ValidationErrorResponse,
)

# Первый элемент `loc` у pydantic - место ошибки в запросе, а не имя поля. В контракте
# путь начинается с самого поля: `routing_policy`, а не `body.routing_policy`.
_REQUEST_LOCATIONS: Final[frozenset[str]] = frozenset(
    {"body", "query", "path", "header", "cookie"},
)


class EndpointNotImplementedError(Exception):
    """Endpoint объявлен контрактом, но обработчик ещё не поставлен.

    Скелет отвечает 501, а не 404: путь существует и его форма зафиксирована, отсутствует
    только реализация. Класс исчезнет вместе с последней заглушкой.
    """


def json_path(loc: tuple[int | str, ...]) -> str | None:
    """Путь pydantic в точечную нотацию контракта: `design.planes[1].raan_deg`."""
    parts = list(loc)
    if parts and parts[0] in _REQUEST_LOCATIONS:
        parts = parts[1:]

    path = ""
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        elif path:
            path += f".{part}"
        else:
            path = part
    return path or None


def _to_error_detail(error: dict[str, Any]) -> ErrorDetail:
    if error["type"] == "missing":
        return ErrorDetail(
            code=ErrorCode.INVALID_SCENARIO_FIELD,
            message="Обязательное поле отсутствует",
            path=json_path(error["loc"]),
        )
    # `input` у ошибки «поле отсутствует» - это объект-контейнер целиком, поэтому значение
    # прикладывается только там, где оно действительно есть.
    return ErrorDetail(
        code=ErrorCode.INVALID_SCENARIO_FIELD,
        message=f"Значение поля недопустимо: {error['msg']}",
        path=json_path(error["loc"]),
        details={"value": jsonable_encoder(error.get("input"))},
    )


async def handle_request_validation_error(request: Request, exc: Exception) -> JSONResponse:
    """Ошибки разбора запроса - ошибки входа: 400 со списком всех найденных."""
    # Тип гарантирован регистрацией обработчика; starlette объявляет аргумент как Exception.
    errors = cast(RequestValidationError, exc).errors()
    body = ValidationErrorResponse(errors=[_to_error_detail(error) for error in errors])
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content=jsonable_encoder(body),
    )


async def handle_not_implemented(request: Request, exc: Exception) -> JSONResponse:
    """Ответ заглушки: код `NOT_IMPLEMENTED` и endpoint, которого ещё нет."""
    body = ErrorResponse(
        error=ErrorDetail(
            code=NOT_IMPLEMENTED_CODE,
            message="Endpoint объявлен контрактом, реализация появится в следующих срезах",
            details={"method": request.method, "endpoint": request.url.path},
        ),
    )
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content=jsonable_encoder(body),
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    app.add_exception_handler(EndpointNotImplementedError, handle_not_implemented)
