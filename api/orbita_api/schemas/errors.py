"""Конверт ошибок API (`05_API.md` §3) и коды ошибок (`03_GLOSSARY.md` §3.6)."""

from enum import StrEnum
from typing import Any, Final, Literal, TypeAlias

from pydantic import BaseModel, Field


class ErrorCode(StrEnum):
    """Коды ошибок API (`03_GLOSSARY.md` §3.6)."""

    UNSUPPORTED_SCHEMA_VERSION = "UNSUPPORTED_SCHEMA_VERSION"
    INVALID_SCENARIO_FIELD = "INVALID_SCENARIO_FIELD"
    DUPLICATE_NODE_ID = "DUPLICATE_NODE_ID"
    UNRESOLVED_REFERENCE = "UNRESOLVED_REFERENCE"
    INVALID_TIME_GRID = "INVALID_TIME_GRID"
    INVALID_OUTAGE_INTERVAL = "INVALID_OUTAGE_INTERVAL"
    MISSING_SITE_ROLE = "MISSING_SITE_ROLE"
    RUN_NOT_READY = "RUN_NOT_READY"
    RUN_FAILED = "RUN_FAILED"
    EXPERIMENT_BUDGET_EXCEEDED = "EXPERIMENT_BUDGET_EXCEEDED"
    INTERNAL_INCONSISTENCY = "INTERNAL_INCONSISTENCY"
    STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE"


# Код скелета: endpoint объявлен контрактом, но обработчик ещё не поставлен. В глоссарий
# он не входит и исчезнет вместе с последней заглушкой, поэтому живёт отдельным литералом,
# а не значением `ErrorCode`.
NotImplementedCode: TypeAlias = Literal["NOT_IMPLEMENTED"]
NOT_IMPLEMENTED_CODE: Final[NotImplementedCode] = "NOT_IMPLEMENTED"


class ErrorDetail(BaseModel):
    """Одна ошибка: код, человекочитаемое сообщение, поле и доказательство."""

    code: ErrorCode | NotImplementedCode = Field(description="Код ошибки")
    message: str = Field(description="Сообщение для пользователя")
    path: str | None = Field(
        default=None,
        description=(
            "Путь до проблемного поля в точечной нотации с индексами в квадратных "
            "скобках, например design.planes[2].raan_deg; null, если ошибка не о поле"
        ),
    )
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Доказательство ошибки, например фактическое значение поля",
    )


class ErrorResponse(BaseModel):
    """Ответ с одной ошибкой (`05_API.md` §3)."""

    error: ErrorDetail


class ValidationErrorResponse(BaseModel):
    """Ответ со всеми найденными ошибками входа.

    Валидация возвращает список целиком, а не первую ошибку: инженер исправляет файл за
    один проход (`05_API.md` §3).
    """

    errors: list[ErrorDetail]


_RESPONSE_BY_STATUS: Final[dict[int, tuple[type[BaseModel], str]]] = {
    400: (ValidationErrorResponse, "Ошибки входа, все найденные списком"),
    404: (ErrorResponse, "Сущность не найдена"),
    409: (ErrorResponse, "Конфликт Idempotency-Key: ключ занят другим запросом"),
    422: (ErrorResponse, "EXPERIMENT_BUDGET_EXCEEDED: sweep не укладывается в бюджет"),
    501: (ErrorResponse, "NOT_IMPLEMENTED: endpoint объявлен, реализации ещё нет"),
    503: (ErrorResponse, "STORAGE_UNAVAILABLE: хранилище недоступно, degraded mode запрещён"),
}


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """Описания ответов с ошибками для декоратора роутера.

    Коды перечисляются в каждом endpoint явно: клиент должен видеть в OpenAPI ровно те
    ошибки, которые этот endpoint действительно возвращает (`05_API.md` §3).
    """
    responses: dict[int | str, dict[str, Any]] = {}
    for status in statuses:
        model, description = _RESPONSE_BY_STATUS[status]
        responses[status] = {"model": model, "description": description}
    return responses
