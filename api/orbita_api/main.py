from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from orbita_api import API_VERSION
from orbita_api.adapters.registry import build_registry
from orbita_api.routers import health
from orbita_api.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Клиенты хранилищ создаются один раз на процесс.

    Создание клиента на каждый запрос стоило бы нового TCP-соединения и рукопожатия;
    закрытие на остановке освобождает соединения, не дожидаясь сборщика мусора.
    """
    registry = build_registry(get_settings())
    app.state.probe_registry = registry
    try:
        yield
    finally:
        await registry.aclose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ОРБИТА API",
        version=API_VERSION,
        lifespan=lifespan,
        # Документация лежит под /api, потому что nginx фронтенда проксирует на api
        # только этот префикс.
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
