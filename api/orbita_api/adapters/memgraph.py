from neo4j import AsyncDriver, AsyncGraphDatabase

from orbita_api.schemas import ServiceName


class MemgraphProbe:
    """Проверяет Bolt-соединение с Memgraph.

    Обязательный расчёт от Memgraph не зависит (ADR-009), поэтому его недоступность —
    это degraded mode, а не отказ api.
    """

    def __init__(self, url: str, user: str, password: str, timeout_s: float) -> None:
        # Memgraph в compose поднимается без аутентификации: пустой логин означает,
        # что драйверу не нужно передавать учётные данные вовсе.
        auth = (user, password) if user else None
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(
            url,
            auth=auth,
            connection_timeout=timeout_s,
            connection_acquisition_timeout=timeout_s,
            max_connection_pool_size=1,
        )

    @property
    def service(self) -> ServiceName:
        return ServiceName.MEMGRAPH

    async def ping(self) -> bool:
        await self._driver.verify_connectivity()
        return True

    async def aclose(self) -> None:
        await self._driver.close()
