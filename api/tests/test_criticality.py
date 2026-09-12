"""HTTP adapter tests for the resilience report."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from orbita_api.services import criticality


@pytest.mark.asyncio
async def test_run_criticality_translates_core_report(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = uuid4()
    context = SimpleNamespace(scenario=object(), policy=SimpleNamespace())
    entry = SimpleNamespace(
        satellite_id="SAT-01",
        plane_id="P-01",
        delta_min_client_availability=-0.25,
        delta_worst_max_gap_s=120,
        affected_clients=("CLIENT-1",),
        min_cut_frequency=0.5,
        articulation_frequency=0.25,
    )
    monkeypatch.setattr(criticality.results, "load_context", _context_loader(context))
    monkeypatch.setattr(
        criticality.resilience,
        "criticality",
        lambda scenario, policy: SimpleNamespace(satellites=(entry,)),
    )

    report = await criticality.run_criticality(None, None, run_id)  # type: ignore[arg-type]

    assert report.run_id == run_id
    assert report.satellites[0].satellite_id == "SAT-01"
    assert report.satellites[0].plane_id == "P-01"
    assert report.satellites[0].affected_clients == ["CLIENT-1"]
    assert report.satellites[0].articulation_frequency == 0.25


def _context_loader(context: object) -> object:
    async def load_context(session: object, storage: object, run_id: object) -> object:
        return context

    return load_context


class _FakeJob:
    def __init__(self, *, status: object = "queued") -> None:
        self.id = uuid4()
        self.status = status
        self.payload = {"progress": 0.4}
        self.error = None
        self.finished_at = None


class _FakeSession:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


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
    job = _FakeJob(status=criticality.RunStatus.SUCCEEDED)

    class FakeRepository:
        def __init__(self, session: object) -> None:
            pass

        async def find_for_criticality(self, run_id: object) -> _FakeJob:
            return job

    monkeypatch.setattr(criticality, "JobRepository", FakeRepository)
    session = _FakeSession()

    state = await criticality.cancel_criticality(session, uuid4())  # type: ignore[arg-type]

    assert state is not None
    assert state["status"] == criticality.RunStatus.SUCCEEDED
    assert session.commits == 0
