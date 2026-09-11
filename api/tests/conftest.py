"""Приспособления интеграционных тестов: база, миграции и клиент приложения.

База берётся тремя способами, в порядке убывания приоритета:

1. `ORBITA_TEST_DATABASE_URL` — готовая база; так работает CI, где Postgres поднят
   сервисом workflow;
2. контейнер `postgres:16` через `testcontainers` — так работает разработчик локально;
3. если нет ни того, ни другого, тесты помечаются `skip` с объяснением: образ проверок
   собирается без доступа к сокету Docker, и `make test` в нём обязан оставаться зелёным.

Схема создаётся миграциями Alembic, а не `metadata.create_all`: проверяться должна та
последовательность, которая поедет на боевую базу.
"""

import asyncio
import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Final

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from orbita_api.main import create_app
from orbita_api.settings import get_settings

TEST_DATABASE_URL_ENV: Final[str] = "ORBITA_TEST_DATABASE_URL"
POSTGRES_DSN_ENV: Final[str] = "ORBITA_POSTGRES_DSN"
POSTGRES_IMAGE: Final[str] = "postgres:16.15-alpine"
ASYNC_SCHEME: Final[str] = "postgresql+asyncpg://"

SKIP_REASON: Final[str] = (
    "Нужна база Postgres: задайте ORBITA_TEST_DATABASE_URL или дайте доступ к Docker "
    "для testcontainers"
)

# `jobs` ни с чем не связана внешними ключами, поэтому CASCADE до неё не доходит и она
# перечислена явно.
TRUNCATE_STATEMENT: Final[str] = "TRUNCATE TABLE projects, jobs RESTART IDENTITY CASCADE"


def repository_path(relative: str) -> Path:
    """Путь внутри репозитория: тесты идут и из исходников, и из образа проверок."""
    for directory in Path(__file__).resolve().parents:
        candidate = directory / relative
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"{relative} не найден рядом с тестами")


def read_json(relative: str) -> dict[str, Any]:
    """Сценарий или негативная фикстура так, как они лежат в репозитории."""
    return dict(json.loads(repository_path(relative).read_text(encoding="utf-8")))


def as_async_url(url: str) -> str:
    """Любая форма адреса Postgres приводится к драйверу asyncpg."""
    _, _, tail = url.partition("://")
    return f"{ASYNC_SCHEME}{tail}"


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    configured = os.environ.get(TEST_DATABASE_URL_ENV)
    if configured:
        yield as_async_url(configured)
        return

    try:
        from testcontainers.community.postgres import PostgresContainer
    except ImportError:
        pytest.skip(SKIP_REASON)

    try:
        container = PostgresContainer(POSTGRES_IMAGE)
        container.start()
    except Exception as error:
        pytest.skip(f"{SKIP_REASON}: {error}")

    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5432)
        yield (
            f"{ASYNC_SCHEME}{container.username}:{container.password}"
            f"@{host}:{port}/{container.dbname}"
        )
    finally:
        container.stop()


@pytest.fixture(scope="session")
def migrated_database(database_url: str) -> str:
    """Применяет миграции один раз за сессию тестов."""
    config = Config(str(repository_path("api/alembic.ini")))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")
    return database_url


@pytest.fixture(scope="session")
def client(migrated_database: str) -> Iterator[TestClient]:
    """Приложение с движком, направленным на тестовую базу.

    Настройки кэшируются на процесс, поэтому кэш сбрасывается до создания приложения и
    после тестов: иначе адрес тестовой базы утёк бы в остальные тесты того же запуска.
    """
    previous = os.environ.get(POSTGRES_DSN_ENV)
    os.environ[POSTGRES_DSN_ENV] = migrated_database
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as test_client:
            yield test_client
    finally:
        if previous is None:
            os.environ.pop(POSTGRES_DSN_ENV, None)
        else:
            os.environ[POSTGRES_DSN_ENV] = previous
        get_settings.cache_clear()


@pytest.fixture
def clean_database(migrated_database: str) -> Iterator[None]:
    """Каждый тест начинает с пустой базы.

    Очистка вместо отката транзакции: приложение коммитит само, и тест обязан видеть то
    же состояние, которое увидел бы следующий HTTP-запрос.
    """
    truncate(migrated_database)
    yield


def truncate(url: str) -> None:
    async def run() -> None:
        engine = create_async_engine(url, poolclass=NullPool)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(TRUNCATE_STATEMENT))
        finally:
            await engine.dispose()

    asyncio.run(run())
