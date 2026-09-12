"""Очередь расчётов на живых Postgres и Redis (`05_API.md` §2, `06_STORAGE.md` §5, §7).

Ни одного идентификатора и ни одного числа из сценариев кейса: ожидаемые значения
считаются тем же ядром прямо в тесте, а имена клиентов берутся из загруженного файла
(ADR-015).
"""

import asyncio
import json
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from typing import Any, Final
from uuid import UUID, uuid4

import pytest
from arq.connections import RedisSettings
from arq.worker import Worker
from fastapi.testclient import TestClient
from httpx2 import Response
from orbita_core import ENGINE_VERSION, engine
from orbita_core.engine import ProgressCallback, RunResult
from orbita_core.engine import RunStage as CoreRunStage
from orbita_core.routing import RoutingPolicy
from orbita_worker.artifacts import ArtifactSink, StoredArtifacts
from orbita_worker.events import RedisRunEvents
from orbita_worker.keys import QUEUE_NAME
from orbita_worker.runner import Calculation, execute_run
from orbita_worker.settings import WorkerSettings, on_shutdown, on_startup
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from conftest import UNREACHABLE_REDIS_URL, application, read_json
from orbita_api.routers import runs as runs_router

pytestmark = pytest.mark.usefixtures("clean_database")

CASE_SCENARIO: Final[str] = "scenarios/hidden_like.json"

# Сколько ждать смены статуса. Сутки этого сценария ядро считает меньше секунды, так что
# запас нужен только на старт воркера и запись результата.
STATUS_TIMEOUT_S: Final[float] = 30.0
POLL_STEP_S: Final[float] = 0.05

# Задержка перед стартом воркера в тесте потока событий: поток должен успеть подписаться
# на канал, иначе расчёт закончится раньше первого события.
WORKER_DELAY_S: Final[float] = 0.3

# Шаг искусственно замедленного расчёта: между стадиями успевает прийти отмена.
SLOW_STAGE_S: Final[float] = 0.2

# Heartbeat и пауза перед отменой в тесте молчащего потока: за паузу успевает пройти
# несколько интервалов, иначе комментариев можно и не дождаться.
HEARTBEAT_STEP_S: Final[float] = 0.1
SILENCE_S: Final[float] = 0.5

TERMINAL: Final[frozenset[str]] = frozenset({"succeeded", "failed", "cancelled"})
STAGE_ORDER: Final[tuple[str, ...]] = (
    "validate",
    "geometry",
    "contacts",
    "routing",
    "analytics",
    "persist",
    "complete",
)


@pytest.fixture
def queue(required_redis_url: str) -> Iterator[str]:
    """Пустая очередь на каждый тест: чужие задачи не должны попадать в burst-воркер."""

    async def flush() -> None:
        client: Redis = Redis.from_url(required_redis_url)
        try:
            await client.flushdb()
        finally:
            await client.aclose()

    asyncio.run(flush())
    yield required_redis_url


def variant_id_of(client: TestClient, scenario: Mapping[str, Any], title: str) -> str:
    response = client.post("/api/projects", json={"title": title, "scenario": scenario})
    assert response.status_code == 201, response.text
    project = response.json()
    detail = client.get(f"/api/projects/{project['id']}")
    assert detail.status_code == 200, detail.text
    return str(detail.json()["variants"][0]["id"])


def post_run(
    client: TestClient,
    variant_id: str,
    policy: str = "bfs_shortest",
    idempotency_key: str | None = None,
) -> Response:
    headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
    return client.post(
        "/api/runs",
        json={"variant_id": variant_id, "routing_policy": policy},
        headers=headers,
    )


def created_run(
    client: TestClient,
    variant_id: str,
    policy: str = "bfs_shortest",
) -> dict[str, Any]:
    response = post_run(client, variant_id, policy)
    assert response.status_code == 202, response.text
    return dict(response.json())


def run_worker_burst(redis_url: str) -> None:
    """Воркер в тестовом режиме: берёт всё, что лежит в очереди, и останавливается."""

    async def work() -> None:
        worker = Worker(
            functions=WorkerSettings.functions,
            queue_name=QUEUE_NAME,
            redis_settings=RedisSettings.from_dsn(redis_url),
            on_startup=on_startup,
            on_shutdown=on_shutdown,
            burst=True,
            poll_delay=POLL_STEP_S,
            # Повторы arq в тесте только скрыли бы ошибку задачи за второй попыткой.
            max_tries=1,
            # Обработчики сигналов ставятся только в главном потоке, а воркер здесь
            # запускается и из фонового.
            handle_signals=False,
        )
        try:
            await worker.async_run()
        finally:
            # `Worker.close()` посылает SIGUSR1, которого нет в Windows, поэтому воркер
            # останавливается вручную: движок Postgres и соединения Redis.
            await on_shutdown(worker.ctx)
            await worker.pool.aclose(close_connection_pool=True)

    asyncio.run(work())


def sessionmaker_for(database_url: str) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        create_async_engine(database_url, poolclass=NullPool),
        expire_on_commit=False,
    )


def run_in_background(target: Callable[[], None]) -> threading.Thread:
    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    return thread


def execute_in_background(
    database_url: str,
    redis_url: str,
    run_id: str,
    calculate: Calculation = engine.run,
    artifacts: ArtifactSink | None = None,
) -> threading.Thread:
    """Запускает задачу воркера прямо, без очереди: тесту нужен контроль над расчётом."""

    async def work() -> None:
        client: Redis = Redis.from_url(redis_url)
        extra: dict[str, Any] = {} if artifacts is None else {"artifacts": artifacts}
        try:
            await execute_run(
                UUID(run_id),
                sessionmaker_for(database_url),
                RedisRunEvents(client),
                calculate=calculate,
                **extra,
            )
        finally:
            await client.aclose()

    return run_in_background(lambda: asyncio.run(work()))


def wait_for_status(client: TestClient, run_id: str, expected: set[str]) -> dict[str, Any]:
    deadline = time.monotonic() + STATUS_TIMEOUT_S
    state: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"/api/runs/{run_id}")
        assert response.status_code == 200, response.text
        state = dict(response.json())
        if state["status"] in expected:
            return state
        time.sleep(POLL_STEP_S)
    raise AssertionError(f"Запуск остался в состоянии {state.get('status')}, ждали {expected}")


def fetch_rows(
    database_url: str,
    statement: str,
    parameters: dict[str, Any],
) -> list[dict[str, Any]]:
    async def query() -> list[dict[str, Any]]:
        db_engine = create_async_engine(database_url, poolclass=NullPool)
        try:
            async with db_engine.connect() as connection:
                result = await connection.execute(text(statement), parameters)
                return [dict(row._mapping) for row in result]
        finally:
            await db_engine.dispose()

    return asyncio.run(query())


def result_rows(database_url: str, table: str, run_id: str) -> list[dict[str, Any]]:
    return fetch_rows(
        database_url,
        f"SELECT * FROM {table} WHERE run_id = :run_id",
        {"run_id": UUID(run_id)},
    )


def job_rows(database_url: str, run_id: str) -> list[dict[str, Any]]:
    """Журнал задач ищется по полю payload: внешнего ключа у него нет."""
    return fetch_rows(
        database_url,
        "SELECT * FROM jobs WHERE payload->>'run_id' = :run_id",
        {"run_id": run_id},
    )


def expected_result(scenario: Mapping[str, Any], policy: RoutingPolicy) -> RunResult:
    """Тот же расчёт, выполненный в тесте: с ним сверяется то, что записал воркер."""
    return engine.run(dict(scenario), policy)


def test_run_passes_all_stages_and_stores_metrics(
    client: TestClient,
    migrated_database: str,
    queue: str,
) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Расчёт суток")

    run = created_run(client, variant_id)
    assert run["status"] == "queued"
    assert run["stage"] == "validate"
    assert run["engine_version"] == ENGINE_VERSION
    assert run["total_ticks"] == scenario["environment"]["horizon_s"] // (
        scenario["environment"]["step_s"]
    )

    run_worker_burst(queue)
    finished = wait_for_status(client, run["id"], {"succeeded"})

    assert finished["stage"] == "complete"
    assert finished["progress"] == pytest.approx(1.0)
    assert finished["completed_ticks"] == finished["total_ticks"]
    assert finished["started_at"] is not None
    assert finished["finished_at"] is not None
    assert finished["duration_ms"] >= 0
    assert finished["error"] is None
    # MinIO в тестах не отвечает, поэтому трасса уходит в локальный каталог, а запуск
    # помечается degraded: артефакт есть, но записан мимо внешнего хранилища.
    assert finished["trace_uri"] is not None
    assert finished["degraded_mode"] is True

    stored = {
        row["client_id"]: row
        for row in result_rows(migrated_database, "client_metrics", run["id"])
    }
    expected = expected_result(scenario, RoutingPolicy.BFS_SHORTEST)
    assert set(stored) == {metrics.client_id for metrics in expected.aggregate.clients}
    for metrics in expected.aggregate.clients:
        row = stored[metrics.client_id]
        assert row["availability"] == pytest.approx(metrics.availability)
        assert row["visibility"] == pytest.approx(metrics.visibility)
        assert row["max_gap_s"] == metrics.max_gap_s
        assert row["route_switches"] == metrics.route_switches
        assert row["target_met"] == metrics.target_met
        assert row["outage_count_by_cause"] == {
            str(cause): count for cause, count in metrics.outage_count_by_cause.items()
        }

    config_rows = result_rows(migrated_database, "config_metrics", run["id"])
    assert len(config_rows) == 1
    assert config_rows[0]["min_client_availability"] == pytest.approx(
        expected.aggregate.config.min_client_availability,
    )
    assert config_rows[0]["worst_max_gap_s"] == expected.aggregate.config.worst_max_gap_s

    outages = result_rows(migrated_database, "outage_intervals", run["id"])
    assert len(outages) == len(expected.aggregate.outages)
    assert {str(row["primary_cause"]) for row in outages} == {
        str(outage.primary_cause) for outage in expected.aggregate.outages
    }

    jobs = job_rows(migrated_database, run["id"])
    assert len(jobs) == 1
    assert jobs[0]["status"] == "succeeded"
    assert jobs[0]["attempts"] == 1
    assert jobs[0]["finished_at"] is not None


def sse_events(client: TestClient, run_id: str) -> list[dict[str, Any]]:
    """Читает поток до конца: он закрывается сам на конечном статусе."""
    events: list[dict[str, Any]] = []
    with client.stream("GET", f"/api/runs/{run_id}/events") as response:
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("text/event-stream")
        for line in response.iter_lines():
            if line.startswith("data:"):
                events.append(dict(json.loads(line.removeprefix("data:").strip())))
    return events


def test_events_stream_reports_stages_in_order(client: TestClient, queue: str) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Поток событий")
    run = created_run(client, variant_id)

    def delayed_worker() -> None:
        time.sleep(WORKER_DELAY_S)
        run_worker_burst(queue)

    worker = run_in_background(delayed_worker)
    events = sse_events(client, run["id"])
    worker.join(timeout=STATUS_TIMEOUT_S)

    assert events, "поток закрылся, не отдав ни одного события"
    assert all(event["run_id"] == run["id"] for event in events)
    assert events[0]["status"] == "queued"
    assert events[-1]["status"] == "succeeded"
    assert events[-1]["stage"] == "complete"

    positions = [STAGE_ORDER.index(event["stage"]) for event in events]
    assert positions == sorted(positions), "стадии пришли не в порядке 03_GLOSSARY.md §3.4"
    progress = [event["progress"] for event in events]
    assert progress == sorted(progress)


def test_stream_of_finished_run_closes_immediately(client: TestClient, queue: str) -> None:
    """Подключение после расчёта отдаёт итог и закрывается, а не ждёт событий вечно."""
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Поздний подписчик")
    run = created_run(client, variant_id)
    run_worker_burst(queue)
    wait_for_status(client, run["id"], {"succeeded"})

    events = sse_events(client, run["id"])

    assert len(events) == 1
    assert events[0]["status"] == "succeeded"


def test_heartbeat_keeps_silent_stream_open(
    client: TestClient,
    queue: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Пока расчёт молчит, в поток идут комментарии: соединение не должно простаивать."""
    monkeypatch.setattr(runs_router, "HEARTBEAT_INTERVAL_S", HEARTBEAT_STEP_S)
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Очередь без воркера")
    run = created_run(client, variant_id)

    def delayed_cancel() -> None:
        time.sleep(SILENCE_S)
        client.post(f"/api/runs/{run['id']}/cancel")

    canceller = run_in_background(delayed_cancel)
    comments = 0
    statuses: list[str] = []
    with client.stream("GET", f"/api/runs/{run['id']}/events") as response:
        for line in response.iter_lines():
            if line.startswith(":"):
                comments += 1
            elif line.startswith("data:"):
                statuses.append(str(json.loads(line.removeprefix("data:").strip())["status"]))
    canceller.join(timeout=STATUS_TIMEOUT_S)

    assert comments >= 1, "за время ожидания не пришло ни одного heartbeat"
    assert statuses[-1] == "cancelled"


def test_same_idempotency_key_returns_the_same_run(client: TestClient, queue: str) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Идемпотентность")
    key = str(uuid4())

    first = post_run(client, variant_id, idempotency_key=key)
    second = post_run(client, variant_id, idempotency_key=key)

    assert first.status_code == 202, first.text
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]


def test_same_key_with_another_body_is_a_conflict(client: TestClient, queue: str) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Конфликт ключа")
    key = str(uuid4())
    post_run(client, variant_id, idempotency_key=key)

    response = post_run(client, variant_id, policy="persistent", idempotency_key=key)

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_CONFLICT"


def test_same_configuration_is_not_calculated_twice(client: TestClient, queue: str) -> None:
    """Дедупликация по `config_hash` и версии ядра (ADR-011): ключ для этого не нужен."""
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Дедупликация")

    first = post_run(client, variant_id)
    second = post_run(client, variant_id)
    other_policy = post_run(client, variant_id, policy="dijkstra_distance")

    assert first.status_code == 202, first.text
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]
    assert other_policy.status_code == 202, other_policy.text
    assert other_policy.json()["id"] != first.json()["id"]
    assert other_policy.json()["config_hash"] != first.json()["config_hash"]


def test_succeeded_run_is_reused(client: TestClient, queue: str) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Переиспользование")
    run = created_run(client, variant_id)
    run_worker_burst(queue)
    wait_for_status(client, run["id"], {"succeeded"})

    repeated = post_run(client, variant_id)

    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["id"] == run["id"]
    assert repeated.json()["status"] == "succeeded"


def test_unknown_routing_policy_is_rejected(client: TestClient) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Неизвестная политика")

    response = client.post(
        "/api/runs",
        json={"variant_id": variant_id, "routing_policy": "самый быстрый"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["errors"][0]["path"] == "routing_policy"


def test_unknown_run_is_not_found(client: TestClient) -> None:
    missing = str(uuid4())

    assert client.get(f"/api/runs/{missing}").status_code == 404
    assert client.post(f"/api/runs/{missing}/cancel").status_code == 404
    events = client.get(f"/api/runs/{missing}/events")
    assert events.status_code == 404
    assert events.json()["error"]["code"] == "NOT_FOUND"


def test_run_of_unknown_variant_is_not_found(client: TestClient) -> None:
    response = post_run(client, str(uuid4()))

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_queued_run_is_cancelled_immediately(client: TestClient, queue: str) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Отмена в очереди")
    run = created_run(client, variant_id)

    response = client.post(f"/api/runs/{run['id']}/cancel")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    # Воркер обязан увидеть отменённый запуск и не считать его.
    run_worker_burst(queue)
    assert client.get(f"/api/runs/{run['id']}").json()["status"] == "cancelled"


def test_cancel_of_finished_run_is_a_conflict(client: TestClient, queue: str) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Отмена завершённого")
    run = created_run(client, variant_id)
    run_worker_burst(queue)
    wait_for_status(client, run["id"], {"succeeded"})

    response = client.post(f"/api/runs/{run['id']}/cancel")

    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "RUN_NOT_CANCELLABLE"


def slow_calculation(
    scenario: Mapping[str, object],
    policy: RoutingPolicy,
    *,
    progress: ProgressCallback,
) -> RunResult:
    """Расчёт, который заведомо доживёт до отмены."""
    for stage in CoreRunStage:
        progress(stage, 0, 1)
        time.sleep(SLOW_STAGE_S)
    raise AssertionError("расчёт должен был прерваться отменой")


def failing_calculation(
    scenario: Mapping[str, object],
    policy: RoutingPolicy,
    *,
    progress: ProgressCallback,
) -> RunResult:
    progress(CoreRunStage.GEOMETRY, 0, 1)
    raise RuntimeError("аппаратный сбой в тесте")


def test_running_run_is_cancelled_by_the_worker(
    client: TestClient,
    migrated_database: str,
    queue: str,
) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Отмена в работе")
    run = created_run(client, variant_id)
    worker = execute_in_background(migrated_database, queue, run["id"], slow_calculation)

    wait_for_status(client, run["id"], {"running"})
    response = client.post(f"/api/runs/{run['id']}/cancel")
    assert response.status_code == 200, response.text

    cancelled = wait_for_status(client, run["id"], {"cancelled"})
    worker.join(timeout=STATUS_TIMEOUT_S)

    assert cancelled["finished_at"] is not None
    assert cancelled["error"] is None
    assert cancelled["stage"] in STAGE_ORDER


def test_failed_calculation_records_the_stage(
    client: TestClient,
    migrated_database: str,
    queue: str,
) -> None:
    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Падение расчёта")
    run = created_run(client, variant_id)
    worker = execute_in_background(migrated_database, queue, run["id"], failing_calculation)

    failed = wait_for_status(client, run["id"], {"failed"})
    worker.join(timeout=STATUS_TIMEOUT_S)

    assert failed["error"]["code"] == "RUN_FAILED"
    assert failed["error"]["details"]["stage"] == "geometry"
    assert failed["finished_at"] is not None

    jobs = job_rows(migrated_database, run["id"])
    assert jobs[0]["status"] == "failed"
    assert jobs[0]["attempts"] == 1


def test_degraded_mode_calculates_inside_api(migrated_database: str) -> None:
    """Redis недоступен: расчёт идёт в процессе api, ответ помечен заголовком."""
    scenario = read_json(CASE_SCENARIO)
    with application(migrated_database, UNREACHABLE_REDIS_URL) as degraded:
        variant_id = variant_id_of(degraded, scenario, "Degraded mode")

        response = post_run(degraded, variant_id)

        assert response.status_code == 202, response.text
        assert response.headers["X-Degraded-Mode"] == "true"
        finished = wait_for_status(degraded, str(response.json()["id"]), {"succeeded"})
        assert finished["stage"] == "complete"


def test_trace_uri_comes_from_the_artifact_sink(
    client: TestClient,
    migrated_database: str,
    queue: str,
) -> None:
    """Точка подключения хранилища трасс: что она вернула, то и попадает в Run."""
    trace_uri = "runs/test/trace.bin"

    async def sink(run_id: UUID, result: RunResult) -> StoredArtifacts:
        return StoredArtifacts(trace_uri=trace_uri, degraded_mode=False)

    scenario = read_json(CASE_SCENARIO)
    variant_id = variant_id_of(client, scenario, "Артефакты")
    run = created_run(client, variant_id)
    worker = execute_in_background(migrated_database, queue, run["id"], artifacts=sink)

    finished = wait_for_status(client, run["id"], {"succeeded"})
    worker.join(timeout=STATUS_TIMEOUT_S)

    assert finished["trace_uri"] == trace_uri
    assert finished["degraded_mode"] is False
