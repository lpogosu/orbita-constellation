"""Сборка ответов о результате запуска без базы и без docker.

Проверяется то, что считает сам сервис: упаковка шкалы времени, состав снимка отсчёта,
архив Evidence Pack и отбор кандидатов рекомендации. Данные берутся из сценария с чужими
идентификаторами (ADR-015) и считаются ядром прямо в тесте: ни одного числа и ни одного
идентификатора из кейса здесь нет.
"""

from __future__ import annotations

import base64
import io
import json
import zipfile
from dataclasses import replace
from itertools import pairwise
from typing import Final
from uuid import UUID, uuid4

import numpy as np
import pytest
from orbita_core import engine
from orbita_core import scenario as core_scenario
from orbita_core.engine import RunResult
from orbita_core.routing import RoutingPolicy as CoreRoutingPolicy
from orbita_core.scenario import Scenario as CoreScenario

from conftest import read_json
from orbita_api.db import models
from orbita_api.error_handling import InvalidRequestError
from orbita_api.schemas.common import RoutingPolicy, RunStatus
from orbita_api.services import artifacts, comparisons, evidence, results

SCENARIO_PATH: Final[str] = "scenarios/hidden_like.json"

# Отсчёты, на которых проверяется снимок: начало горизонта, середина и последний отсчёт.
SAMPLE_FRACTIONS: Final[tuple[float, ...]] = (0.0, 0.5, 1.0)


@pytest.fixture(scope="module")
def calculated() -> RunResult:
    scenario = core_scenario.parse(read_json(SCENARIO_PATH))
    return engine.run(scenario, CoreRoutingPolicy.BFS_SHORTEST)


@pytest.fixture(scope="module")
def context(calculated: RunResult) -> results.RunContext:
    run_id = uuid4()
    return results.RunContext(
        run_id=run_id,
        scenario=calculated.scenario,
        plan=calculated.plan,
        paths={
            client: list(calculated.routes.paths[client]) for client in calculated.routes.clients
        },
        policy=RoutingPolicy.BFS_SHORTEST,
        export_text=artifacts.export_document(calculated, run_id),
    )


def unpack(bitset: str, total_ticks: int) -> np.ndarray:
    packed = np.frombuffer(base64.b64decode(bitset), dtype=np.uint8)
    return np.unpackbits(packed)[:total_ticks].astype(bool)


def test_timeline_bitsets_match_calculated_routes(
    context: results.RunContext,
    calculated: RunResult,
) -> None:
    """Единицы в bitset доступности стоят ровно на отсчётах с маршрутом."""
    timeline = results.build_timeline(context)

    assert timeline.total_ticks == context.ticks
    assert timeline.step_s == context.scenario.environment.step_s
    assert [item.client_id for item in timeline.clients] == list(context.scenario.client_ids)
    for item in timeline.clients:
        expected = calculated.routes.reachable(item.client_id)
        assert np.array_equal(unpack(item.availability_bitset, timeline.total_ticks), expected)
        # Инвариант 7 `10_FIXTURES.md` §2: видимость не меньше доступности на каждом отсчёте.
        visibility = unpack(item.visibility_bitset, timeline.total_ticks)
        assert np.all(visibility | ~expected)


def test_timeline_explains_every_tick_without_route(context: results.RunContext) -> None:
    """Причина есть там и только там, где маршрута нет."""
    timeline = results.build_timeline(context)

    for item in timeline.clients:
        assert len(item.causes) == timeline.total_ticks
        paths = context.paths[item.client_id]
        for tick, cause in enumerate(item.causes):
            assert (cause is None) == (paths[tick] is not None)


@pytest.mark.parametrize("fraction", SAMPLE_FRACTIONS)
def test_snapshot_paths_lie_on_edges_of_the_same_tick(
    context: results.RunContext,
    fraction: float,
) -> None:
    """Каждое ребро маршрута снимка присутствует в списке рёбер того же отсчёта."""
    tick = min(int(fraction * context.ticks), context.ticks - 1)

    snapshot = results.build_snapshot(
        context.scenario,
        context.plan,
        tick,
        {client: paths[tick] for client, paths in context.paths.items()},
    )

    assert snapshot.t_s == tick * context.step_s
    assert [item.id for item in snapshot.satellites] == [
        satellite.id for satellite in context.scenario.satellites
    ]
    present = {frozenset((edge.a, edge.b)) for edge in snapshot.edges}
    gateways = frozenset(context.scenario.gateway_ids)
    for client in snapshot.clients:
        if not client.reachable:
            assert client.primary_cause is not None
            assert client.hops is None
            continue
        assert client.path[0] == client.client_id
        assert client.path[-1] in gateways
        assert client.hops == len(client.path) - 1
        for first, second in pairwise(client.path):
            assert frozenset((first, second)) in present


def test_snapshot_marks_failed_satellites_as_inactive_but_visible(
    context: results.RunContext,
) -> None:
    """Инвариант 14: аппарат в отказе остаётся в снимке с координатами и `active = false`."""
    failure = next(iter(context.scenario.failures), None)
    if failure is None:
        pytest.skip("В сценарии нет отказов аппаратов")
    tick = results.tick_of(
        int(failure.start_s),
        context.step_s,
        context.scenario.environment.horizon_s,
    )

    snapshot = results.build_snapshot(
        context.scenario,
        context.plan,
        tick,
        {client: paths[tick] for client, paths in context.paths.items()},
    )

    marked = next(item for item in snapshot.satellites if item.id == failure.node_id)
    assert marked.failed is True
    assert marked.active is False
    assert (marked.x_km, marked.y_km, marked.z_km) != (0.0, 0.0, 0.0)
    assert all(failure.node_id not in (edge.a, edge.b) for edge in snapshot.edges)


@pytest.mark.parametrize("t_s", [1, 61, 86400])
def test_time_outside_the_grid_is_rejected(context: results.RunContext, t_s: int) -> None:
    """Отсчёт не из сетки — ошибка входа с указанием параметра."""
    with pytest.raises(InvalidRequestError) as raised:
        results.tick_of(t_s, context.step_s, context.scenario.environment.horizon_s)

    error = raised.value.errors[0]
    assert error.code == "INVALID_SCENARIO_FIELD"
    assert error.path == "t_s"
    assert error.details["value"] == t_s


def test_evidence_pack_is_reproducible_and_readable() -> None:
    """Архив собирается детерминированно, а его файлы читаются как JSON."""
    files = {
        evidence.EXPORT_FILE: json.dumps({"schema_version": "cosmo-A-result-1.0"}),
        evidence.METRICS_FILE: json.dumps({"clients": []}),
        evidence.ENGINE_VERSION_FILE: "orbita-core-test\n",
    }

    first = evidence.pack(files)
    second = evidence.pack(files)

    assert first == second
    with zipfile.ZipFile(io.BytesIO(first)) as archive:
        assert archive.namelist() == list(files)
        assert json.loads(archive.read(evidence.EXPORT_FILE))["schema_version"] == (
            "cosmo-A-result-1.0"
        )
        assert archive.read(evidence.ENGINE_VERSION_FILE).decode("utf-8").strip()


def _summary(scenario: CoreScenario, run_id: UUID, availability: float) -> comparisons.RunSummary:
    """Запуск с заданной минимальной доступностью, собранный без базы."""
    variant_id = uuid4()
    return comparisons.RunSummary(
        run=models.Run(
            id=run_id,
            variant_id=variant_id,
            routing_policy=RoutingPolicy.BFS_SHORTEST,
            status=RunStatus.SUCCEEDED,
        ),
        variant=models.Variant(id=variant_id, title="Вариант", scenario={}),
        scenario=scenario,
        config=models.ConfigMetrics(
            run_id=run_id,
            min_client_availability=availability,
            mean_client_availability=availability,
            worst_max_gap_s=0,
            mean_hops=2.0,
            max_hops=3,
            route_switches_total=0,
            backup_path_count_min=1,
            outage_count_by_cause={},
            target_met_clients=[],
        ),
        clients=[],
    )


def test_candidate_pool_keeps_base_first_and_drops_other_grids() -> None:
    """Кандидаты — запуски на тех же условиях; базовый всегда первый."""
    scenario = core_scenario.parse(read_json(SCENARIO_PATH))
    other_grid = replace(
        scenario,
        environment=replace(scenario.environment, step_s=scenario.environment.step_s * 2),
    )
    base = _summary(scenario, uuid4(), 0.90)
    requested = _summary(scenario, uuid4(), 0.95)
    same_grid = _summary(scenario, uuid4(), 0.92)
    foreign = _summary(other_grid, uuid4(), 0.99)

    pool = comparisons.candidate_pool(base, requested, [same_grid, foreign, requested])

    assert [item.run.id for item in pool] == [
        base.run.id,
        requested.run.id,
        same_grid.run.id,
    ]


def test_candidate_pool_without_alternatives_is_the_base_alone() -> None:
    """Запрошен сам базовый запуск и сравнивать не с чем: набор из одного варианта."""
    scenario = core_scenario.parse(read_json(SCENARIO_PATH))
    base = _summary(scenario, uuid4(), 0.90)

    assert comparisons.candidate_pool(base, base, []) == [base]
