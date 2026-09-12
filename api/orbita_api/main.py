from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Final

from fastapi import FastAPI

from orbita_api import API_VERSION
from orbita_api.adapters.registry import build_registry
from orbita_api.db.session import build_engine, build_sessionmaker
from orbita_api.error_handling import register_error_handlers
from orbita_api.routers import (
    analysis,
    comparisons,
    experiments,
    health,
    projects,
    runs,
    scenarios,
    variants,
)
from orbita_api.runtime import build_runtime
from orbita_api.settings import get_settings

# Схемы, которые FastAPI сам добавляет ради ответа 422 у endpoint с параметрами.
_HTTP_VALIDATION_ERROR: Final[str] = "HTTPValidationError"
_VALIDATION_ERROR: Final[str] = "ValidationError"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Клиенты хранилищ создаются один раз на процесс.

    Создание клиента на каждый запрос стоило бы нового TCP-соединения и рукопожатия;
    закрытие на остановке освобождает соединения, не дожидаясь сборщика мусора. По той
    же причине пул соединений с Postgres живёт всё время работы процесса, а сессия -
    один запрос.
    """
    settings = get_settings()
    registry = build_registry(settings)
    engine = build_engine(settings.postgres_dsn)
    sessionmaker = build_sessionmaker(engine)
    app.state.probe_registry = registry
    app.state.sessionmaker = sessionmaker
    app.state.run_runtime = build_runtime(settings, sessionmaker)
    try:
        yield
    finally:
        await app.state.run_runtime.aclose()
        await registry.aclose()
        await engine.dispose()


def _drop_fastapi_validation_responses(schema: dict[str, Any]) -> None:
    """Убирает из схемы автоматический ответ 422 с `HTTPValidationError`.

    Ошибки входа переводятся обработчиком в 400 с конвертом `05_API.md` §3, поэтому
    оставленный 422 описывал бы ответ, которого сервис не даёт. Объявленный вручную 422
    (`EXPERIMENT_BUDGET_EXCEEDED`) ссылается на `ErrorResponse` и остаётся на месте.
    """
    for operations in schema.get("paths", {}).values():
        for operation in operations.values():
            response = operation.get("responses", {}).get("422")
            if response is None:
                continue
            content = response.get("content", {}).get("application/json", {})
            ref: str = content.get("schema", {}).get("$ref", "")
            if ref.rsplit("/", 1)[-1] == _HTTP_VALIDATION_ERROR:
                del operation["responses"]["422"]

    schemas = schema.get("components", {}).get("schemas", {})
    for name in (_HTTP_VALIDATION_ERROR, _VALIDATION_ERROR):
        schemas.pop(name, None)


class OrbitaAPI(FastAPI):
    """FastAPI с единственной правкой генерации OpenAPI."""

    def openapi(self) -> dict[str, Any]:
        if self.openapi_schema is None:
            schema = super().openapi()
            _drop_fastapi_validation_responses(schema)
            self.openapi_schema = schema
        return self.openapi_schema


def create_app() -> FastAPI:
    app = OrbitaAPI(
        title="ОРБИТА API",
        version=API_VERSION,
        lifespan=lifespan,
        # Документация лежит под /api, потому что nginx фронтенда проксирует на api
        # только этот префикс.
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    register_error_handlers(app)
    for router in (
        health.router,
        scenarios.router,
        projects.router,
        variants.router,
        runs.router,
        comparisons.router,
        experiments.router,
        analysis.router,
    ):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
