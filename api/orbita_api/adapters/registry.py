import asyncio
from collections.abc import Sequence

from fastapi import Request

from orbita_api.adapters.base import ServiceProbe, probe_status
from orbita_api.adapters.memgraph import MemgraphProbe
from orbita_api.adapters.minio import MinioProbe
from orbita_api.adapters.postgres import PostgresProbe
from orbita_api.adapters.redis import RedisProbe, create_client
from orbita_api.adapters.worker import WorkerProbe
from orbita_api.schemas import ServiceName, ServiceStatus
from orbita_api.settings import Settings

# Недоступность любого из этих сервисов переводит систему в degraded mode: обязательный
# расчёт продолжает работать локальными адаптерами, но очередь, графовые запросы и
# хранение трасс выключаются (06_STORAGE.md §7).
DEGRADED_MODE_SERVICES: frozenset[ServiceName] = frozenset(
    {ServiceName.REDIS, ServiceName.MEMGRAPH, ServiceName.MINIO},
)


class ProbeRegistry:
    """Набор проб внешних сервисов, живущий столько же, сколько приложение."""

    def __init__(self, probes: Sequence[ServiceProbe], timeout_s: float) -> None:
        self._probes = tuple(probes)
        self._timeout_s = timeout_s

    async def collect(self) -> dict[ServiceName, ServiceStatus]:
        """Опрашивает сервисы параллельно: иначе health ждёт сумму всех таймаутов."""
        statuses = await asyncio.gather(
            *(probe_status(probe, self._timeout_s) for probe in self._probes),
        )
        # api отвечает на запрос, значит он доступен по определению.
        collected = {ServiceName.API: ServiceStatus.UP}
        collected.update(
            {probe.service: status for probe, status in zip(self._probes, statuses, strict=True)},
        )
        return collected

    async def aclose(self) -> None:
        for probe in self._probes:
            await probe.aclose()


def build_registry(settings: Settings) -> ProbeRegistry:
    """Собирает пробы по настройкам.

    Клиент Redis один на две пробы: воркер виден только через свою отметку в Redis.
    """
    redis_client = create_client(settings.redis_url, settings.probe_timeout_s)
    probes: list[ServiceProbe] = [
        PostgresProbe(settings.postgres_dsn, settings.probe_timeout_s),
        RedisProbe(redis_client),
        MemgraphProbe(
            settings.memgraph_url,
            settings.memgraph_user,
            settings.memgraph_password,
            settings.probe_timeout_s,
        ),
        MinioProbe(
            settings.minio_endpoint,
            settings.minio_access_key,
            settings.minio_secret_key,
            settings.minio_region,
            settings.probe_timeout_s,
        ),
        WorkerProbe(redis_client, settings.worker_health_key),
    ]
    return ProbeRegistry(probes, settings.probe_timeout_s)


def get_registry(request: Request) -> ProbeRegistry:
    """Зависимость FastAPI; в тестах подменяется через `dependency_overrides`."""
    registry = request.app.state.probe_registry
    if not isinstance(registry, ProbeRegistry):
        raise RuntimeError("Реестр проб не инициализирован")
    return registry
