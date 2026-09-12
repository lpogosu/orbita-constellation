import asyncio
from collections.abc import Sequence
from dataclasses import dataclass

from fastapi import Request

from orbita_api.adapters.base import ServiceProbe, is_alive, probe_status
from orbita_api.adapters.local import LocalArtifactStore, NullGraphStore
from orbita_api.adapters.memgraph import MemgraphGraphStore, MemgraphProbe, build_driver
from orbita_api.adapters.minio import MinioArtifactStore, MinioProbe
from orbita_api.adapters.postgres import PostgresProbe
from orbita_api.adapters.redis import RedisProbe, create_client
from orbita_api.adapters.storage import ArtifactStore, GraphStore
from orbita_api.adapters.worker import WorkerProbe
from orbita_api.schemas import ServiceName, ServiceStatus
from orbita_api.settings import Settings, StorageMode

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


@dataclass(frozen=True, slots=True)
class StorageBundle:
    """Пара хранилищ, выбранная на время одной операции, и отметка degraded mode."""

    artifacts: ArtifactStore
    graph: GraphStore
    degraded_mode: bool


class StorageRegistry:
    """Выбирает хранилища артефактов и графа по их доступности (`06_STORAGE.md` §7).

    Доступность проверяется на каждом сохранении, а не один раз при старте: MinIO может
    подняться позже api и упасть раньше него, и обе ситуации должны отражаться в ответе
    без перезапуска сервиса. Проверка стоит один таймаут пробы, а сохранение артефактов
    происходит раз на запуск расчёта.
    """

    def __init__(
        self,
        mode: StorageMode,
        external_artifacts: ArtifactStore | None,
        external_graph: GraphStore | None,
        local_artifacts: ArtifactStore,
        local_graph: GraphStore,
        timeout_s: float,
    ) -> None:
        self._mode = mode
        self._external_artifacts = external_artifacts
        self._external_graph = external_graph
        self._local_artifacts = local_artifacts
        self._local_graph = local_graph
        self._timeout_s = timeout_s

    @property
    def local_artifacts(self) -> ArtifactStore:
        """Запасное хранилище: сервис откатывается на него при сбое внешнего."""
        return self._local_artifacts

    async def resolve(self) -> StorageBundle:
        """Хранилища для текущей операции.

        В режиме `full` пробы не выполняются: внешние хранилища объявлены обязательными,
        и подмена их локальными скрыла бы отказ, ради обнаружения которого режим и задан.
        """
        if self._mode is StorageMode.LOCAL or self._external_artifacts is None:
            return StorageBundle(self._local_artifacts, self._local_graph, degraded_mode=True)
        if self._mode is StorageMode.FULL:
            graph = self._external_graph or self._local_graph
            return StorageBundle(self._external_artifacts, graph, degraded_mode=False)

        artifacts_alive, graph_alive = await asyncio.gather(
            is_alive(self._external_artifacts.ping, self._timeout_s),
            self._graph_alive(),
        )
        graph = self._external_graph if graph_alive and self._external_graph else self._local_graph
        return StorageBundle(
            artifacts=self._external_artifacts if artifacts_alive else self._local_artifacts,
            graph=graph,
            degraded_mode=not (artifacts_alive and graph_alive),
        )

    async def _graph_alive(self) -> bool:
        if self._external_graph is None:
            return False
        return await is_alive(self._external_graph.ping, self._timeout_s)

    async def aclose(self) -> None:
        for store in (self._external_artifacts, self._external_graph):
            if store is not None:
                await store.aclose()
        await self._local_artifacts.aclose()
        await self._local_graph.aclose()


def build_storage_registry(settings: Settings) -> StorageRegistry:
    """Собирает хранилища по настройкам.

    В режиме `local` клиенты MinIO и Memgraph не создаются вовсе: соединений, которые
    заведомо не понадобятся, быть не должно.
    """
    external_artifacts: ArtifactStore | None = None
    external_graph: GraphStore | None = None
    if settings.storage_mode is not StorageMode.LOCAL:
        external_artifacts = MinioArtifactStore(
            settings.minio_endpoint,
            settings.minio_access_key,
            settings.minio_secret_key,
            settings.minio_region,
            settings.minio_bucket,
            settings.probe_timeout_s,
            settings.storage_timeout_s,
        )
        external_graph = MemgraphGraphStore(
            build_driver(
                settings.memgraph_url,
                settings.memgraph_user,
                settings.memgraph_password,
                settings.probe_timeout_s,
            ),
        )
    return StorageRegistry(
        mode=settings.storage_mode,
        external_artifacts=external_artifacts,
        external_graph=external_graph,
        local_artifacts=LocalArtifactStore(settings.artifacts_dir),
        local_graph=NullGraphStore(),
        timeout_s=settings.probe_timeout_s,
    )


def get_storage_registry(request: Request) -> StorageRegistry:
    """Зависимость FastAPI; в тестах подменяется через `dependency_overrides`."""
    registry = request.app.state.storage_registry
    if not isinstance(registry, StorageRegistry):
        raise RuntimeError("Реестр хранилищ не инициализирован")
    return registry
