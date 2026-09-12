"""Small lifecycle checks for configuration experiments."""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from orbita_api.schemas.common import RoutingPolicy, RunStatus
from orbita_api.schemas.experiments import ExperimentPoint
from orbita_api.services import experiments


class _Session:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


@pytest.mark.asyncio
async def test_experiment_is_failed_when_all_points_finish_with_a_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    experiment_id = uuid4()
    project_id = uuid4()
    base_variant_id = uuid4()
    experiment = SimpleNamespace(
        id=experiment_id,
        project_id=project_id,
        base_variant_id=base_variant_id,
        axes=[],
        budget={"max_points": 4, "max_seconds": 60},
        routing_policy=RoutingPolicy.BFS_SHORTEST,
        status=RunStatus.RUNNING,
        error=None,
        created_at=datetime.now(UTC),
    )

    def point(status: RunStatus) -> SimpleNamespace:
        row = SimpleNamespace(
            run_id=uuid4(),
            _run_status=status,
            min_client_availability=None,
            worst_max_gap_s=None,
            mean_client_availability=None,
        )
        row._schema = ExperimentPoint(
            id=uuid4(),
            experiment_id=experiment_id,
            params={},
            config_hash="a" * 64,
            run_id=row.run_id,
        )
        return row

    points = [point(RunStatus.SUCCEEDED), point(RunStatus.FAILED)]

    class Repository:
        def __init__(self, session: object) -> None:
            pass

        async def get(self, value: object) -> object:
            return experiment

    monkeypatch.setattr(experiments, "ExperimentRepository", Repository)

    async def fake_points(session: object, value: object) -> list[SimpleNamespace]:
        return points

    monkeypatch.setattr(experiments, "_points", fake_points)
    session = _Session()

    result = await experiments.get_experiment(session, object(), experiment_id)  # type: ignore[arg-type]

    assert result.status == RunStatus.FAILED
    assert result.completed_points == 2
    assert experiment.error["code"] == "SWEEP_POINT_FAILED"
    assert session.commits == 1
