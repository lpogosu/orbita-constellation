from redis.asyncio import Redis

from orbita_api.schemas import ServiceName


def create_client(url: str, timeout_s: float) -> Redis:
    """Клиент Redis с явными таймаутами.

    Без них пропавшая сеть до Redis блокирует обработчик запроса на минуты.
    """
    client: Redis = Redis.from_url(
        url,
        socket_connect_timeout=timeout_s,
        socket_timeout=timeout_s,
        retry_on_timeout=False,
    )
    return client


class RedisProbe:
    """Проверяет Redis: очередь arq, прогресс Run и кэш preview (06_STORAGE.md §5)."""

    def __init__(self, client: Redis) -> None:
        self._client = client

    @property
    def service(self) -> ServiceName:
        return ServiceName.REDIS

    async def ping(self) -> bool:
        return bool(await self._client.ping())

    async def aclose(self) -> None:
        await self._client.aclose()
