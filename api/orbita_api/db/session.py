"""Асинхронный движок, фабрика сессий и зависимость обработчиков."""

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def build_engine(dsn: str) -> AsyncEngine:
    """Движок на весь процесс.

    `pool_pre_ping` отсеивает соединения, умершие вместе с перезапуском Postgres: без
    него первый запрос после перезапуска базы падает, хотя база уже поднялась.
    """
    return create_async_engine(dsn, pool_pre_ping=True)


def build_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Фабрика сессий.

    `expire_on_commit=False`: после commit обработчик читает поля сохранённой строки,
    чтобы собрать ответ, а обновление просроченных атрибутов в асинхронной сессии
    потребовало бы неявного запроса из синхронного кода и упало бы.
    """
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Сессия на один HTTP-запрос.

    Фабрика создаётся один раз в lifespan: пул соединений переживает запрос, сессия — нет.
    """
    factory = request.app.state.sessionmaker
    if not isinstance(factory, async_sessionmaker):
        raise RuntimeError("Фабрика сессий не инициализирована")
    async with factory() as session:
        yield session
