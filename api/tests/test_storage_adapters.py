"""Адаптеры MinIO и Memgraph на живых хранилищах (`06_STORAGE.md` §4-6).

Адреса берутся из окружения; без них тесты помечаются `skip`, потому что образ проверок
поднимается без доступа к стеку, а `make test` в нём обязан оставаться зелёным.

    docker compose -f deploy/docker-compose.yml up -d minio memgraph
    ORBITA_TEST_MINIO_ENDPOINT=http://localhost:9000 \
    ORBITA_TEST_MEMGRAPH_URI=bolt://localhost:7687 pytest tests/test_storage_adapters.py
"""

import asyncio
import os
import uuid
from collections.abc import Awaitable, Callable, Iterator
from typing import Any, Final, TypeVar

import numpy as np
import pytest

from orbita_api.adapters.local import NullGraphStore
from orbita_api.adapters.memgraph import MemgraphGraphStore, build_driver
from orbita_api.adapters.minio import LIFECYCLE_DAYS, MinioArtifactStore, build_client
from orbita_api.adapters.storage import (
    ArtifactKind,
    ArtifactNotFoundError,
    ContactInterval,
    LineageEdge,
    Retention,
    artifact_key,
    contact_intervals,
    content_type,
)
from orbita_api.services.trace_codec import encode_trace
from plans import HIDDEN_SCENARIO, load_plan, plane_ids

MINIO_ENDPOINT_ENV: Final[str] = "ORBITA_TEST_MINIO_ENDPOINT"
MINIO_ACCESS_KEY_ENV: Final[str] = "ORBITA_TEST_MINIO_ACCESS_KEY"
MINIO_SECRET_KEY_ENV: Final[str] = "ORBITA_TEST_MINIO_SECRET_KEY"
MEMGRAPH_URI_ENV: Final[str] = "ORBITA_TEST_MEMGRAPH_URI"

MINIO_SKIP: Final[str] = f"Нужен MinIO: задайте {MINIO_ENDPOINT_ENV}"
MEMGRAPH_SKIP: Final[str] = f"Нужен Memgraph: задайте {MEMGRAPH_URI_ENV}"

TIMEOUT_S: Final[float] = 5.0
ENGINE_VERSION: Final[str] = "orbita-core-test"
ROUTING_POLICY: Final[str] = "bfs_shortest"

T = TypeVar("T")


@pytest.fixture
def minio_store() -> Iterator[MinioArtifactStore]:
    """Отдельный бакет на каждый тест: чужие объекты не должны влиять на результат."""
    endpoint = os.environ.get(MINIO_ENDPOINT_ENV)
    if not endpoint:
        pytest.skip(MINIO_SKIP)
    access_key = os.environ.get(MINIO_ACCESS_KEY_ENV, "orbita")
    secret_key = os.environ.get(MINIO_SECRET_KEY_ENV, "orbita-secret")
    bucket = f"orbita-test-{uuid.uuid4().hex[:12]}"
    store = MinioArtifactStore(
        endpoint,
        access_key,
        secret_key,
        "us-east-1",
        bucket,
        TIMEOUT_S,
        TIMEOUT_S,
    )
    try:
        yield store
    finally:
        drop_bucket(endpoint, access_key, secret_key, bucket)
        asyncio.run(store.aclose())


def drop_bucket(endpoint: str, access_key: str, secret_key: str, bucket: str) -> None:
    client = build_client(endpoint, access_key, secret_key, "us-east-1", TIMEOUT_S, TIMEOUT_S)
    try:
        listing: dict[str, Any] = client.list_objects_v2(Bucket=bucket)
    except Exception:
        return
    for item in listing.get("Contents", []):
        client.delete_object(Bucket=bucket, Key=item["Key"])
    client.delete_bucket(Bucket=bucket)
    client.close()


@pytest.fixture
def memgraph_uri() -> str:
    uri = os.environ.get(MEMGRAPH_URI_ENV)
    if not uri:
        pytest.skip(MEMGRAPH_SKIP)
    return uri


def with_graph_store(uri: str, scenario: Callable[[MemgraphGraphStore], Awaitable[T]]) -> T:
    """Открывает хранилище, выполняет сценарий и закрывает драйвер в том же цикле событий.

    Драйвер neo4j привязан к циклу, в котором создан: открытие в одном, а закрытие в
    другом падает на закрытом сокете.
    """

    async def main() -> T:
        store = MemgraphGraphStore(build_driver(uri, "", "", TIMEOUT_S))
        try:
            return await scenario(store)
        finally:
            await store.aclose()

    return asyncio.run(main())


def test_minio_stores_and_returns_the_trace(minio_store: MinioArtifactStore) -> None:
    plan = load_plan(HIDDEN_SCENARIO)
    blob = encode_trace(plan)
    key = artifact_key(uuid.uuid4(), ArtifactKind.TRACE)

    async def scenario() -> tuple[str, bytes, bool, bool]:
        uri = await minio_store.put(
            key,
            blob,
            content_type(ArtifactKind.TRACE),
            Retention.INTERACTIVE,
        )
        stored = await minio_store.get(key)
        existed = await minio_store.exists(key)
        await minio_store.delete(key)
        return uri, stored, existed, await minio_store.exists(key)

    uri, stored, existed, exists_after_delete = asyncio.run(scenario())

    assert uri == f"s3://{minio_store.bucket}/{key}"
    assert stored == blob
    assert existed
    assert not exists_after_delete


def test_minio_reports_missing_object(minio_store: MinioArtifactStore) -> None:
    """Отсутствующая трасса — повод пересчитать запуск, а не ошибка драйвера."""
    key = artifact_key(uuid.uuid4(), ArtifactKind.TRACE)

    async def scenario() -> None:
        # Бакет создаётся первой записью, поэтому чтение пустого ключа идёт после неё.
        await minio_store.put(
            artifact_key(uuid.uuid4(), ArtifactKind.EXPORT),
            b"{}",
            content_type(ArtifactKind.EXPORT),
            Retention.PROJECT,
        )
        await minio_store.get(key)

    with pytest.raises(ArtifactNotFoundError):
        asyncio.run(scenario())


def test_minio_bucket_gets_lifecycle_rules(minio_store: MinioArtifactStore) -> None:
    """TTL из `06_STORAGE.md` §6 живёт правилами бакета, а не намерением."""
    key = artifact_key(uuid.uuid4(), ArtifactKind.TRACE)
    asyncio.run(
        minio_store.put(key, b"x", content_type(ArtifactKind.TRACE), Retention.SWEEP_POINT),
    )

    client = build_client(
        os.environ[MINIO_ENDPOINT_ENV],
        os.environ.get(MINIO_ACCESS_KEY_ENV, "orbita"),
        os.environ.get(MINIO_SECRET_KEY_ENV, "orbita-secret"),
        "us-east-1",
        TIMEOUT_S,
        TIMEOUT_S,
    )
    rules = client.get_bucket_lifecycle_configuration(Bucket=minio_store.bucket)["Rules"]
    tagging = client.get_object_tagging(Bucket=minio_store.bucket, Key=key)["TagSet"]
    client.close()

    days = {rule["Filter"]["Tag"]["Value"]: rule["Expiration"]["Days"] for rule in rules}
    assert days == {retention.value: value for retention, value in LIFECYCLE_DAYS.items()}
    assert tagging == [{"Key": "retention", "Value": Retention.SWEEP_POINT.value}]


def expected_intervals(node_id: str, relative: str) -> set[tuple[str, int, int]]:
    """Интервалы узла прямо из битовой матрицы: с ними сверяется содержимое графа."""
    plan = load_plan(relative)
    return {
        (
            interval.target if interval.source == node_id else interval.source,
            interval.start_tick,
            interval.end_tick,
        )
        for interval in contact_intervals(plan)
        if node_id in (interval.source, interval.target)
    }


def busiest_node(relative: str) -> str:
    """Узел с наибольшим числом контактов: на пустом узле тест ничего не доказывает."""
    plan = load_plan(relative)
    counts = plan.bits.sum(axis=0)
    edge = int(np.argmax(counts))
    return plan.nodes[int(plan.edges[edge, 0])]


def test_memgraph_stores_contacts_as_intervals(memgraph_uri: str) -> None:
    plan = load_plan(HIDDEN_SCENARIO)
    run_id = uuid.uuid4()
    node_id = busiest_node(HIDDEN_SCENARIO)

    async def scenario(
        store: MemgraphGraphStore,
    ) -> tuple[tuple[ContactInterval, ...], tuple[ContactInterval, ...]]:
        await store.save_run_graph(
            run_id,
            ENGINE_VERSION,
            ROUTING_POLICY,
            plan,
            plane_ids(HIDDEN_SCENARIO),
        )
        stored = await store.contacts_of(run_id, node_id)
        await store.delete_run(run_id)
        return stored, await store.contacts_of(run_id, node_id)

    stored, after_delete = with_graph_store(memgraph_uri, scenario)

    assert {(item.target, item.start_tick, item.end_tick) for item in stored} == expected_intervals(
        node_id,
        HIDDEN_SCENARIO,
    )
    assert all(item.source == node_id for item in stored)
    assert all(item.min_distance_km <= item.max_distance_km for item in stored)
    assert after_delete == ()


def test_memgraph_keeps_variant_lineage(memgraph_uri: str) -> None:
    project_id = uuid.uuid4()
    base_id = uuid.uuid4()
    child_id = uuid.uuid4()
    change = {"path": "design.planes[0].raan_deg", "before": 0.0, "after": 12.0}
    deltas = {"delta_min_availability": 0.05, "delta_worst_max_gap_s": -120.0}

    async def scenario(store: MemgraphGraphStore) -> tuple[LineageEdge, ...]:
        await store.save_variant_lineage(base_id, project_id, "базовый", "0" * 64, None, [], {})
        await store.save_variant_lineage(
            child_id,
            project_id,
            "сдвиг плоскости",
            "1" * 64,
            base_id,
            [change],
            deltas,
        )
        return await store.lineage(project_id)

    edges = with_graph_store(memgraph_uri, scenario)
    by_id = {edge.variant_id: edge for edge in edges}

    assert set(by_id) == {base_id, child_id}
    assert by_id[base_id].parent_variant_id is None
    assert by_id[child_id].parent_variant_id == base_id
    assert by_id[child_id].diff == (change,)
    assert by_id[child_id].deltas == deltas


def test_null_graph_store_answers_empty() -> None:
    """Заглушка отвечает пусто и не бросает: граф необязателен (ADR-009)."""
    store = NullGraphStore()
    plan = load_plan(HIDDEN_SCENARIO)
    run_id = uuid.uuid4()

    async def scenario() -> tuple[tuple[ContactInterval, ...], bool]:
        await store.save_run_graph(run_id, ENGINE_VERSION, ROUTING_POLICY, plan, {})
        return await store.contacts_of(run_id, plan.nodes[0]), store.persistent

    contacts, persistent = asyncio.run(scenario())

    assert contacts == ()
    assert not persistent
