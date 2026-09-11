from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from orbita_api.schemas import ServiceName


class PostgresProbe:
    """Проверяет, что Postgres принимает соединение и выполняет запрос."""

    def __init__(self, dsn: str, timeout_s: float) -> None:
        # NullPool: проба не должна держать соединение между запросами и не должна
        # получить из пула соединение, которое умерло вместе с перезапуском базы.
        self._engine: AsyncEngine = create_async_engine(
            dsn,
            poolclass=NullPool,
            connect_args={"timeout": timeout_s},
        )

    @property
    def service(self) -> ServiceName:
        return ServiceName.POSTGRES

    async def ping(self) -> bool:
        async with self._engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True

    async def aclose(self) -> None:
        await self._engine.dispose()
