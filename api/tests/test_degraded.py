"""Degraded mode: расчёт доходит до конца при недоступных MinIO и Memgraph.

Главное требование `06_STORAGE.md` §7 — отказ внешнего хранилища не отбрасывает уже
посчитанные метрики. Поэтому здесь проверяется не только флаг в отчёте, но и то, что
транзакция с метриками доходит до коммита, а трасса оказывается в локальном каталоге.

Хранилища подменяются напрямую, без docker: сбой «MinIO отвечает на пробу, но падает на
записи» иначе не воспроизвести, а именно он опаснее полной недоступности.
"""

import asyncio
import json
import os
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable, Mapping, Sequence
from pathlib import Path
from typing import Any, Final, TypeVar
from uuid import UUID, uuid4

import pytest
from orbita_core import contacts
from orbita_core import scenario as core_scenario
from orbita_core.contacts import ContactPlan
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from conftest import read_json
from orbita_api.adapters.local import LocalArtifactStore, NullGraphStore
from orbita_api.adapters.registry import StorageRegistry
from orbita_api.adapters.storage import (
    ArtifactKind,
    ArtifactStore,
    ContactInterval,
    GraphStore,
    LineageEdge,
    Retention,
    artifact_key,
)
from orbita_api.db import models
from orbita_api.schemas.common import RoutingPolicy, RunStage, RunStatus
from orbita_api.services.artifacts import PersistReport, persist_run_artifacts
from orbita_api.services.trace_codec import decode_trace
from orbita_api.settings import StorageMode
from plans import HIDDEN_SCENARIO

pytestmark = pytest.mark.usefixtures("clean_database")

T = TypeVar("T")

PROBE_TIMEOUT_S: Final[float] = 0.2
# Адрес api берётся из окружения: порт на хосте задаётся переменной `API_PORT`
# (`deploy/.env.example`), и на занятой машине он не 8000.
API_URL_ENV: Final[str] = "ORBITA_TEST_API_URL"
DEFAULT_API_URL: Final[str] = "http://localhost:8000"
HEALTH_TIMEOUT_S: Final[float] = 5.0
DEGRADED_SERVICES: Final[tuple[str, ...]] = ("redis", "memgraph", "minio")
EXPORT_JSON: Final[bytes] = b'{"schema_version":"cosmo-A-result-1.0"}'


class UnavailableArtifactStore:
    """Хранилище, которого нет: не отвечает на пробу и падает на любой операции."""

    async def put(self, key: str, data: bytes, content_type: str, retention: Retention) -> str:
        raise ConnectionError("хранилище артефактов недоступно")

    async def get(self, key: str) -> bytes:
        raise ConnectionError("хранилище артефактов недоступно")

    async def exists(self, key: str) -> bool:
        raise ConnectionError("хранилище артефактов недоступно")

    async def delete(self, key: str) -> None:
        raise ConnectionError("хранилище артефактов недоступно")

    async def ping(self) -> bool:
        return False

    async def aclose(self) -> None:
        """Соединения не было."""


class FlakyArtifactStore(UnavailableArtifactStore):
    """Отвечает на пробу, но падает на записи.

    Так выглядит MinIO, упавший между выбором адаптера и сохранением трассы: расчёт уже
    выполнен, метрики лежат в транзакции, и терять их нельзя.
    """

    async def ping(self) -> bool:
        return True


class UnavailableGraphStore:
    """Графовая база, объявляющая себя рабочей и падающая на записи."""

    @property
    def persistent(self) -> bool:
        return True

    async def save_run_graph(
        self,
        run_id: UUID,
        engine_version: str,
        routing_policy: str,
        plan: ContactPlan,
        plane_ids: Mapping[str, str],
    ) -> None:
        raise ConnectionError("графовая база недоступна")

    async def save_variant_lineage(
        self,
        variant_id: UUID,
        project_id: UUID,
        title: str,
        config_hash: str,
        parent_variant_id: UUID | None,
        diff: Sequence[Mapping[str, Any]],
        deltas: Mapping[str, float],
    ) -> None:
        raise ConnectionError("графовая база недоступна")

    async def contacts_of(self, run_id: UUID, node_id: str) -> tuple[ContactInterval, ...]:
        raise ConnectionError("графовая база недоступна")

    async def lineage(self, project_id: UUID) -> tuple[LineageEdge, ...]:
        raise ConnectionError("графовая база недоступна")

    async def delete_run(self, run_id: UUID) -> None:
        raise ConnectionError("графовая база недоступна")

    async def ping(self) -> bool:
        return True

    async def aclose(self) -> None:
        """Соединения не было."""


def registry_of(
    external_artifacts: ArtifactStore | None,
    external_graph: GraphStore | None,
    artifacts_dir: Path,
    mode: StorageMode = StorageMode.AUTO,
) -> StorageRegistry:
    return StorageRegistry(
        mode=mode,
        external_artifacts=external_artifacts,
        external_graph=external_graph,
        local_artifacts=LocalArtifactStore(artifacts_dir),
        local_graph=NullGraphStore(),
        timeout_s=PROBE_TIMEOUT_S,
    )


def load_plan_and_scenario() -> tuple[ContactPlan, dict[str, Any]]:
    parsed = core_scenario.parse(read_json(HIDDEN_SCENARIO))
    return contacts.build(parsed), dict(core_scenario.to_dict(parsed))


def run_with_session(url: str, scenario: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Выполняет сценарий в одной сессии и закрывает движок вместе с циклом событий."""

    async def main() -> T:
        engine = create_async_engine(url, poolclass=NullPool)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with factory() as session:
                return await scenario(session)
        finally:
            await engine.dispose()

    return asyncio.run(main())


async def seed_run(session: AsyncSession, scenario: dict[str, Any]) -> UUID:
    """Проект, вариант и запуск, к которому привязываются артефакты."""
    project = models.Project(title="проверка degraded")
    session.add(project)
    await session.flush()

    variant = models.Variant(
        project_id=project.id,
        parent_variant_id=None,
        title="базовый",
        scenario=scenario,
        diff_from_parent=[],
        config_hash=uuid4().hex * 2,
    )
    session.add(variant)
    await session.flush()

    run = models.Run(
        variant_id=variant.id,
        routing_policy=RoutingPolicy.BFS_SHORTEST,
        engine_version="orbita-core-test",
        config_hash=uuid4().hex * 2,
        status=RunStatus.RUNNING,
        stage=RunStage.PERSIST,
        progress=1.0,
        completed_ticks=0,
        total_ticks=0,
    )
    session.add(run)
    await session.flush()
    return run.id


def test_unavailable_storages_keep_the_run_and_write_locally(
    tmp_path: Path,
    migrated_database: str,
) -> None:
    plan, scenario = load_plan_and_scenario()
    storage = registry_of(UnavailableArtifactStore(), UnavailableGraphStore(), tmp_path)

    async def work(session: AsyncSession) -> tuple[UUID, PersistReport]:
        run_id = await seed_run(session, scenario)
        report = await persist_run_artifacts(session, run_id, plan, EXPORT_JSON, storage)
        await session.commit()
        return run_id, report

    run_id, report = run_with_session(migrated_database, work)

    assert report.degraded_mode
    assert not report.graph_saved
    trace_path = tmp_path / artifact_key(run_id, ArtifactKind.TRACE)
    assert trace_path.is_file()
    assert decode_trace(trace_path.read_bytes()).nodes == plan.nodes
    assert report.trace_uri == trace_path.as_uri()


def test_artifacts_are_registered_with_their_retention(
    tmp_path: Path,
    migrated_database: str,
) -> None:
    """Реестр артефактов знает срок: трасса живёт сутки, экспорт — до удаления проекта."""
    plan, scenario = load_plan_and_scenario()
    storage = registry_of(UnavailableArtifactStore(), UnavailableGraphStore(), tmp_path)

    async def work(session: AsyncSession) -> tuple[UUID, list[models.Artifact]]:
        run_id = await seed_run(session, scenario)
        await persist_run_artifacts(session, run_id, plan, EXPORT_JSON, storage)
        await session.commit()
        result = await session.scalars(
            select(models.Artifact).where(models.Artifact.run_id == run_id),
        )
        return run_id, list(result.all())

    run_id, artifacts = run_with_session(migrated_database, work)
    by_kind = {artifact.kind: artifact for artifact in artifacts}

    assert set(by_kind) == {str(ArtifactKind.TRACE), str(ArtifactKind.EXPORT)}
    assert by_kind[str(ArtifactKind.TRACE)].expires_at is not None
    assert by_kind[str(ArtifactKind.EXPORT)].expires_at is None
    assert by_kind[str(ArtifactKind.EXPORT)].size_bytes == len(EXPORT_JSON)
    assert by_kind[str(ArtifactKind.TRACE)].uri.endswith("trace.bin")
    assert (tmp_path / artifact_key(run_id, ArtifactKind.EXPORT)).read_bytes() == EXPORT_JSON


def test_failure_after_metrics_does_not_discard_them(
    tmp_path: Path,
    migrated_database: str,
) -> None:
    """Сбой хранилища после расчёта: метрики остаются в Postgres, трасса уходит локально."""
    plan, scenario = load_plan_and_scenario()
    storage = registry_of(FlakyArtifactStore(), UnavailableGraphStore(), tmp_path)

    async def work(session: AsyncSession) -> tuple[UUID, PersistReport]:
        run_id = await seed_run(session, scenario)
        session.add(
            models.ConfigMetrics(
                run_id=run_id,
                min_client_availability=0.5,
                mean_client_availability=0.75,
                worst_max_gap_s=600,
                mean_hops=3.5,
                max_hops=5,
                route_switches_total=4,
                backup_path_count_min=1,
                target_met_clients=[],
            ),
        )
        await session.flush()
        report = await persist_run_artifacts(session, run_id, plan, EXPORT_JSON, storage)
        await session.commit()
        return run_id, report

    run_id, report = run_with_session(migrated_database, work)

    async def read_back(session: AsyncSession) -> models.ConfigMetrics | None:
        return await session.get(models.ConfigMetrics, run_id)

    metrics = run_with_session(migrated_database, read_back)

    assert report.degraded_mode
    assert metrics is not None
    assert (tmp_path / artifact_key(run_id, ArtifactKind.TRACE)).is_file()


def test_failure_of_the_last_storage_is_not_hidden(
    tmp_path: Path,
    migrated_database: str,
) -> None:
    """Когда падает и локальный каталог, сохранять трассу негде — это ошибка запуска."""
    plan, scenario = load_plan_and_scenario()
    blocked = tmp_path / "занято"
    blocked.write_bytes(b"")
    storage = registry_of(FlakyArtifactStore(), UnavailableGraphStore(), blocked / "artifacts")

    async def work(session: AsyncSession) -> None:
        run_id = await seed_run(session, scenario)
        await persist_run_artifacts(session, run_id, plan, EXPORT_JSON, storage)

    with pytest.raises(OSError):
        run_with_session(migrated_database, work)


def read_health() -> dict[str, Any]:
    url = f"{os.environ.get(API_URL_ENV, DEFAULT_API_URL)}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=HEALTH_TIMEOUT_S) as response:
            return dict(json.loads(response.read()))
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        pytest.skip(f"api на {url} не отвечает: {error}")


def test_health_of_the_degraded_profile_reports_storages_down() -> None:
    """Профиль `deploy/compose.degraded.yml` поднимается и честно показывает состояние.

        docker compose -f deploy/docker-compose.yml -f deploy/compose.degraded.yml up -d api
    """
    health = read_health()
    services = health["services"]
    if all(services.get(name) == "up" for name in DEGRADED_SERVICES):
        pytest.skip("по этому адресу отвечает полный стек, а не профиль degraded")

    assert health["degraded_mode"] is True
    assert services["api"] == "up"
    assert services["postgres"] == "up"
    assert [services[name] for name in DEGRADED_SERVICES] == ["down"] * len(DEGRADED_SERVICES)


def test_registry_prefers_external_storages_when_they_answer(tmp_path: Path) -> None:
    storage = registry_of(FlakyArtifactStore(), UnavailableGraphStore(), tmp_path)

    bundle = asyncio.run(storage.resolve())

    assert isinstance(bundle.artifacts, FlakyArtifactStore)
    assert isinstance(bundle.graph, UnavailableGraphStore)
    assert not bundle.degraded_mode


def test_local_mode_ignores_external_storages(tmp_path: Path) -> None:
    """Режим `local` не должен трогать MinIO, даже когда тот отвечает."""
    storage = registry_of(
        FlakyArtifactStore(),
        UnavailableGraphStore(),
        tmp_path,
        StorageMode.LOCAL,
    )

    bundle = asyncio.run(storage.resolve())

    assert isinstance(bundle.artifacts, LocalArtifactStore)
    assert isinstance(bundle.graph, NullGraphStore)
    assert bundle.degraded_mode


def test_full_mode_keeps_external_storages_even_when_silent(tmp_path: Path) -> None:
    """Режим `full` не подменяет хранилища: отказ должен быть виден, а не сглажен."""
    storage = registry_of(
        UnavailableArtifactStore(),
        UnavailableGraphStore(),
        tmp_path,
        StorageMode.FULL,
    )

    bundle = asyncio.run(storage.resolve())

    assert isinstance(bundle.artifacts, UnavailableArtifactStore)
    assert not bundle.degraded_mode
