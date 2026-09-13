"""HTTP adapter tests for the resilience report."""

from collections.abc import Callable
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from orbita_core import resilience
from orbita_core.routing import RoutingPolicy as CoreRoutingPolicy

from orbita_api.schemas.common import RoutingPolicy, RunStatus
from orbita_api.services import criticality, results


@pytest.mark.asyncio
async def test_run_criticality_translates_core_report(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = uuid4()
    context = SimpleNamespace(scenario=object(), policy=RoutingPolicy.DIJKSTRA_DISTANCE)
    entry = SimpleNamespace(
        satellite_id="SAT-01",
        plane_id="P-01",
        delta_min_client_availability=-0.25,
        delta_worst_max_gap_s=120,
        affected_clients=("CLIENT-1",),
        min_cut_frequency=0.5,
        articulation_frequency=0.25,
    )
    received_policies: list[object] = []
    persisted_progress: list[object] = []

    def fake_criticality(
        scenario: object,
        policy: object,
        *,
        progress: Callable[[int, int], None],
        cancel_check: Callable[[], bool],
    ) -> SimpleNamespace:
        received_policies.append(policy)
        progress(1, 2)
        assert repository.job is not None
        persisted_progress.append(repository.job.payload["progress"])
        return SimpleNamespace(satellites=(entry,))

    repository = _InMemoryJobRepository()
    monkeypatch.setattr(criticality, "JobRepository", lambda session: repository)
    monkeypatch.setattr(results, "load_context", _context_loader(context))
    monkeypatch.setattr(resilience, "criticality", fake_criticality)
    session = _FakeSession()

    report = await criticality.run_criticality(session, None, run_id)  # type: ignore[arg-type]

    assert report.run_id == run_id
    assert report.satellites[0].satellite_id == "SAT-01"
    assert report.satellites[0].plane_id == "P-01"
    assert report.satellites[0].affected_clients == ["CLIENT-1"]
    assert report.satellites[0].articulation_frequency == 0.25
    # Ядро различает политики по идентичности своего перечисления: значение из HTTP-схемы
    # с тем же текстом привело бы к расчёту по BFS.
    assert received_policies == [CoreRoutingPolicy.DIJKSTRA_DISTANCE]
    assert received_policies[0] is CoreRoutingPolicy.DIJKSTRA_DISTANCE
    job = repository.job
    assert job is not None
    assert job.status == RunStatus.SUCCEEDED
    assert job.attempts == 1
    assert job.payload["progress"] == 1.0
    assert persisted_progress == [pytest.approx(0.55)]
    assert job.payload["result"] == report.model_dump(mode="json")


def _context_loader(context: object) -> object:
    async def load_context(session: object, storage: object, run_id: object) -> object:
        return context

    return load_context


class _FakeJob:
    def __init__(self, *, status: object = "queued") -> None:
        self.id = uuid4()
        self.status = status
        self.payload: dict[str, object] = {"progress": 0.4}
        self.error: object = None
        self.attempts = 0
        self.started_at: object = None
        self.finished_at: object = None


class _InMemoryJobRepository:
    """Одна задача на весь тест: как строка `jobs`, которую видят все запросы."""

    def __init__(self) -> None:
        self.job: _FakeJob | None = None

    def enqueue_criticality(self, run_id: UUID) -> _FakeJob:
        self.job = _FakeJob(status=RunStatus.QUEUED)
        self.job.payload = {"run_id": str(run_id), "progress": 0.0}
        return self.job

    async def find_for_criticality(self, run_id: UUID) -> _FakeJob | None:
        return self.job


class _FakeSession:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, instance: object) -> None:
        pass


@pytest.mark.asyncio
async def test_criticality_status_reads_persisted_progress(monkeypatch: pytest.MonkeyPatch) -> None:
    job = _FakeJob(status="running")

    class FakeRepository:
        def __init__(self, session: object) -> None:
            pass

        async def find_for_criticality(self, run_id: object) -> _FakeJob:
            return job

    monkeypatch.setattr(criticality, "JobRepository", FakeRepository)
    run_id = uuid4()

    state = await criticality.get_criticality_status(_FakeSession(), run_id)  # type: ignore[arg-type]

    assert state is not None
    assert state["job_id"] == job.id
    assert state["run_id"] == run_id
    assert state["status"] == "running"
    assert state["progress"] == pytest.approx(0.4)


@pytest.mark.asyncio
async def test_cancel_criticality_is_idempotent_for_finished_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = _FakeJob(status=RunStatus.SUCCEEDED)

    class FakeRepository:
        def __init__(self, session: object) -> None:
            pass

        async def find_for_criticality(self, run_id: object) -> _FakeJob:
            return job

    monkeypatch.setattr(criticality, "JobRepository", FakeRepository)
    session = _FakeSession()

    state = await criticality.cancel_criticality(session, uuid4())  # type: ignore[arg-type]

    assert state is not None
    assert state["status"] == RunStatus.SUCCEEDED
    assert session.commits == 0
