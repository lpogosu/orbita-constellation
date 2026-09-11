import asyncio

import pytest
from fastapi.testclient import TestClient
from orbita_core import ENGINE_VERSION

from orbita_api import API_VERSION
from orbita_api.adapters.registry import ProbeRegistry, get_registry
from orbita_api.main import create_app
from orbita_api.schemas import ServiceName

# Пробы в тестах не ходят в сеть, поэтому таймаут маленький: он проверяется отдельным
# тестом и не должен замедлять остальные.
PROBE_TIMEOUT_S = 0.05


class FakeProbe:
    """Проба с заданным поведением: ответ, исключение или зависание."""

    def __init__(
        self,
        service: ServiceName,
        *,
        alive: bool = True,
        error: Exception | None = None,
        delay_s: float = 0.0,
    ) -> None:
        self._service = service
        self._alive = alive
        self._error = error
        self._delay_s = delay_s
        self.closed = False

    @property
    def service(self) -> ServiceName:
        return self._service

    async def ping(self) -> bool:
        if self._delay_s:
            await asyncio.sleep(self._delay_s)
        if self._error is not None:
            raise self._error
        return self._alive

    async def aclose(self) -> None:
        self.closed = True


def make_client(probes: list[FakeProbe]) -> TestClient:
    """Приложение с подменёнными пробами; на каждый тест создаётся своё."""
    app = create_app()
    registry = ProbeRegistry(probes, PROBE_TIMEOUT_S)
    app.dependency_overrides[get_registry] = lambda: registry
    # TestClient используется без контекстного менеджера намеренно: lifespan создаёт
    # настоящие клиенты хранилищ, а тестам нужны подменённые пробы.
    return TestClient(app)


@pytest.fixture
def all_up_client() -> TestClient:
    return make_client(
        [
            FakeProbe(ServiceName.POSTGRES),
            FakeProbe(ServiceName.REDIS),
            FakeProbe(ServiceName.MEMGRAPH),
            FakeProbe(ServiceName.MINIO),
            FakeProbe(ServiceName.WORKER),
        ],
    )


def test_health_reports_every_service_up(all_up_client: TestClient) -> None:
    response = all_up_client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["services"] == {
        "api": "up",
        "postgres": "up",
        "redis": "up",
        "memgraph": "up",
        "minio": "up",
        "worker": "up",
    }
    assert body["degraded_mode"] is False


def test_health_marks_degraded_mode_when_memgraph_and_minio_are_down() -> None:
    """Недоступные Memgraph и MinIO не роняют api: они переводят его в degraded mode."""
    probes = [
        FakeProbe(ServiceName.POSTGRES),
        FakeProbe(ServiceName.REDIS),
        FakeProbe(ServiceName.MEMGRAPH, error=ConnectionRefusedError("bolt")),
        FakeProbe(ServiceName.MINIO, error=OSError("dns")),
        FakeProbe(ServiceName.WORKER),
    ]
    client = make_client(probes)

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["services"]["memgraph"] == "down"
    assert body["services"]["minio"] == "down"
    assert body["services"]["postgres"] == "up"
    assert body["services"]["api"] == "up"
    assert body["degraded_mode"] is True


def test_health_stays_normal_when_only_postgres_is_down() -> None:
    """degraded mode объявляют только redis, memgraph и minio (06_STORAGE.md §7)."""
    probes = [
        FakeProbe(ServiceName.POSTGRES, error=TimeoutError("connect")),
        FakeProbe(ServiceName.REDIS),
        FakeProbe(ServiceName.MEMGRAPH),
        FakeProbe(ServiceName.MINIO),
        FakeProbe(ServiceName.WORKER),
    ]
    client = make_client(probes)

    body = client.get("/api/health").json()

    assert body["services"]["postgres"] == "down"
    assert body["degraded_mode"] is False


def test_health_treats_hanging_probe_as_down() -> None:
    """Зависшее хранилище не должно задерживать ответ health дольше таймаута пробы."""
    probes = [
        FakeProbe(ServiceName.POSTGRES),
        FakeProbe(ServiceName.REDIS, delay_s=PROBE_TIMEOUT_S * 40),
        FakeProbe(ServiceName.MEMGRAPH),
        FakeProbe(ServiceName.MINIO),
        FakeProbe(ServiceName.WORKER),
    ]
    client = make_client(probes)

    body = client.get("/api/health").json()

    assert body["services"]["redis"] == "down"
    assert body["degraded_mode"] is True


def test_health_treats_negative_answer_as_down() -> None:
    """Проба может ответить без ошибки, но отрицательно: например, нет отметки воркера."""
    probes = [
        FakeProbe(ServiceName.POSTGRES),
        FakeProbe(ServiceName.REDIS),
        FakeProbe(ServiceName.MEMGRAPH),
        FakeProbe(ServiceName.MINIO),
        FakeProbe(ServiceName.WORKER, alive=False),
    ]
    client = make_client(probes)

    body = client.get("/api/health").json()

    assert body["services"]["worker"] == "down"
    assert body["degraded_mode"] is False


def test_registry_closes_every_probe() -> None:
    """Остановка приложения обязана закрыть соединения со всеми хранилищами."""
    probes = [FakeProbe(ServiceName.POSTGRES), FakeProbe(ServiceName.REDIS)]
    registry = ProbeRegistry(probes, PROBE_TIMEOUT_S)

    asyncio.run(registry.aclose())

    assert all(probe.closed for probe in probes)


def test_version_exposes_engine_and_api_versions(all_up_client: TestClient) -> None:
    response = all_up_client.get("/api/version")

    assert response.status_code == 200
    assert response.json() == {"api_version": API_VERSION, "engine_version": ENGINE_VERSION}
