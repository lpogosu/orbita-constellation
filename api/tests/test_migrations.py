"""Миграция как единственный источник схемы (`06_STORAGE.md` §3).

База создаётся `alembic upgrade head`, а модели описывают ту же схему в коде. Разъехаться
они могут молча: приложение работает, пока не встретит забытую колонку. Тесты сверяют то,
что получилось в базе, с моделями и проверяют, что ограничения глоссария действуют.
"""

import asyncio
import uuid
from typing import Any, Final

import pytest
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from orbita_api.db.models import Base

pytestmark = pytest.mark.usefixtures("clean_database")

# Служебная таблица Alembic моделями не описана и в сверке не участвует.
ALEMBIC_VERSION_TABLE: Final[str] = "alembic_version"

INSERT_JOB: Final[str] = (
    "INSERT INTO jobs (id, kind, payload, status, attempts) "
    "VALUES (:id, :kind, '{}'::jsonb, :status, 0)"
)


def columns_of_database(url: str) -> dict[str, dict[str, bool]]:
    """Колонки каждой таблицы базы и их обнуляемость."""

    def describe(connection: Connection) -> dict[str, dict[str, bool]]:
        inspector = inspect(connection)
        return {
            table: {
                column["name"]: bool(column["nullable"])
                for column in inspector.get_columns(table)
            }
            for table in inspector.get_table_names()
            if table != ALEMBIC_VERSION_TABLE
        }

    async def run() -> dict[str, dict[str, bool]]:
        engine = create_async_engine(url, poolclass=NullPool)
        try:
            async with engine.connect() as connection:
                return await connection.run_sync(describe)
        finally:
            await engine.dispose()

    return asyncio.run(run())


def columns_of_models() -> dict[str, dict[str, bool]]:
    return {
        name: {column.name: bool(column.nullable) for column in table.columns}
        for name, table in Base.metadata.tables.items()
    }


def test_migration_and_models_describe_the_same_schema(migrated_database: str) -> None:
    assert columns_of_database(migrated_database) == columns_of_models()


def execute_insert(url: str, parameters: dict[str, Any]) -> None:
    async def run() -> None:
        engine = create_async_engine(url, poolclass=NullPool)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(INSERT_JOB), parameters)
        finally:
            await engine.dispose()

    asyncio.run(run())


def test_status_outside_the_glossary_is_rejected(migrated_database: str) -> None:
    """Значения enum ограничены CHECK, а не только кодом приложения."""
    with pytest.raises(IntegrityError):
        execute_insert(
            migrated_database,
            {"id": uuid.uuid4(), "kind": "daily_run", "status": "почти готово"},
        )


def test_status_from_the_glossary_is_accepted(migrated_database: str) -> None:
    """Страховка от ограничения, которое запрещает вообще всё."""
    execute_insert(
        migrated_database,
        {"id": uuid.uuid4(), "kind": "daily_run", "status": "queued"},
    )
