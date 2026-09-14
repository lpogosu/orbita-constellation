"""Метрики, интервалы перерывов и инварианты `10_FIXTURES.md` §1–2.

Golden-значения проверяются прямо через `metrics.aggregate`: показатель, посчитанный в
обход публичной функции, не доказывает, что сервис отдаст то же число. Инварианты 7, 8,
17 и 18 проверяются на всех сценариях каталога, включая `hidden_like.json` с другими
идентификаторами (ADR-015).
"""

from __future__ import annotations

from dataclasses import replace
from functools import cache
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from orbita_core import contacts, scenario
from orbita_core.contacts import ContactPlan
from orbita_core.diagnosis import OutageCause
from orbita_core.metrics import (
    AggregateResult,
    aggregate,
    longest_gap_ticks,
    outage_runs,
)
from orbita_core.routing import RouteTable, RoutingPolicy, disjoint_paths, route_all
from orbita_core.scenario import Unavailability
from tests.support import SCENARIO_PATHS, SCENARIOS_DIR, scripted_plan

# `10_FIXTURES.md` §1: доли с допуском 1e-4, `max_gap_s` точно, `mean_hops` с допуском 0,01.
GOLDEN: dict[str, dict[str, tuple[float, float, int, float]]] = {
    "01_full_constellation": {
        "C65": (0.9667, 0.9778, 480, 2.29),
        "C70": (0.9875, 0.9986, 120, 2.66),
        "C72": (0.9889, 1.0000, 120, 3.15),
    },
    "02_first_launch": {
        "C65": (0.2722, 0.3819, 34320, 2.07),
        "C70": (0.1583, 0.4875, 39480, 2.14),
        "C72": (0.1264, 0.5847, 47760, 3.12),
    },
    "03_satellite_outages": {
        "C65": (0.7931, 0.8458, 1440, 2.35),
        "C70": (0.8083, 0.9028, 1440, 2.77),
        "C72": (0.8250, 0.9306, 1200, 3.28),
    },
    "04_link_range": {
        "C65": (0.7750, 0.9778, 5640, 2.07),
        "C70": (0.6222, 0.9986, 10680, 2.38),
        "C72": (0.6514, 1.0000, 240, 3.36),
    },
}

CLIENT = "TRM-0"


@cache
def _plan(path: Path) -> ContactPlan:
    return contacts.build(scenario.load(path))


@cache
def _routes(path: Path) -> RouteTable:
    return route_all(_plan(path), RoutingPolicy.BFS_SHORTEST)


@cache
def _result(path: Path, backup_paths: bool) -> AggregateResult:
    target = scenario.load(path).environment.target_availability
    return aggregate(
        _plan(path), _routes(path), target_availability=target, backup_paths=backup_paths
    )


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_golden_client_metrics(name: str) -> None:
    result = _result(SCENARIOS_DIR / f"{name}.json", False)
    actual = {metrics.client_id: metrics for metrics in result.clients}
    assert actual.keys() == GOLDEN[name].keys()
    for client_id, (availability, visibility, max_gap_s, mean_hops) in GOLDEN[name].items():
        metrics = actual[client_id]
        assert metrics.availability == pytest.approx(availability, abs=1e-4)
        assert metrics.visibility == pytest.approx(visibility, abs=1e-4)
        assert metrics.max_gap_s == max_gap_s
        assert metrics.mean_hops == pytest.approx(mean_hops, abs=0.01)


def test_golden_config_metrics_of_full_constellation() -> None:
    """Производные значения `10_FIXTURES.md` §1 для полной группировки."""
    result = _result(SCENARIOS_DIR / "01_full_constellation.json", False)
    assert result.config.min_client_availability == pytest.approx(0.9667, abs=1e-4)
    assert result.config.worst_max_gap_s == 480
    assert result.config.target_met_clients == ("C65", "C70", "C72")


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda path: path.stem)
def test_visibility_not_below_availability(path: Path) -> None:
    """Инвариант 7: путь невозможен без видимого аппарата."""
    for metrics in _result(path, False).clients:
        assert metrics.visibility >= metrics.availability


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda path: path.stem)
def test_outage_durations_match_availability(path: Path) -> None:
    """Инвариант 18: перерывы покрывают ровно недоступное время горизонта."""
    plan = _plan(path)
    result = _result(path, False)
    horizon_s = plan.ticks * plan.step_s
    for metrics in result.clients:
        total = sum(
            outage.duration_s
            for outage in result.outages
            if outage.client_id == metrics.client_id
        )
        assert total == pytest.approx((1.0 - metrics.availability) * horizon_s)


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda path: path.stem)
def test_truncated_flag_marks_exactly_edge_outages(path: Path) -> None:
    """Инвариант 17: флаг стоит тогда и только тогда, когда перерыв касается края сетки."""
    plan = _plan(path)
    horizon_s = plan.ticks * plan.step_s
    for outage in _result(path, False).outages:
        touches_edge = outage.start_s == 0 or outage.end_s == horizon_s
        assert outage.truncated_by_horizon is touches_edge


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda path: path.stem)
def test_every_outage_has_primary_cause(path: Path) -> None:
    result = _result(path, False)
    for outage in result.outages:
        assert outage.primary_cause in OutageCause
        assert outage.primary_cause is not OutageCause.INTERNAL_INCONSISTENCY
        assert outage.causes[0] is outage.primary_cause
        assert len(set(outage.causes)) == len(outage.causes)
    counted = sum(
        sum(metrics.outage_count_by_cause.values()) for metrics in result.clients
    )
    assert counted == len(result.outages)


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda path: path.stem)
def test_failed_satellite_never_raises_availability(path: Path) -> None:
    """Инвариант 8: отказ аппарата на весь горизонт никому не помогает."""
    source = scenario.load(path)
    horizon_s = float(source.environment.horizon_s)
    degraded = replace(
        source,
        failures=(
            *source.failures,
            Unavailability(node_id=source.satellites[0].id, start_s=0.0, end_s=horizon_s),
        ),
    )
    plan = contacts.build(degraded)
    routes = route_all(plan, RoutingPolicy.BFS_SHORTEST)
    after = aggregate(
        plan,
        routes,
        target_availability=source.environment.target_availability,
        backup_paths=False,
    )
    before = {metrics.client_id: metrics for metrics in _result(path, False).clients}
    for metrics in after.clients:
        assert metrics.availability <= before[metrics.client_id].availability + 1e-12


def test_outage_interval_bounds_and_evidence() -> None:
    """Границы `[start_s; end_s)` и доказательства берутся с первого отсчёта перерыва."""
    links = ((0, 1, 500.0), (0, 3, 800.0), (1, 2, 900.0))
    plan = scripted_plan(
        satellite_count=2,
        gateway_count=1,
        client_count=1,
        links=links,
        # Второй и третий отсчёты без линии клиента, последний — без межспутниковой линии.
        present=(
            (True, True, True),
            (True, False, True),
            (True, False, True),
            (True, True, True),
            (False, True, True),
        ),
        gateway_available=[[True]] * 5,
        step_s=60,
    )
    result = aggregate(
        plan, route_all(plan, RoutingPolicy.BFS_SHORTEST), target_availability=0.9
    )
    working_path = (CLIENT, "SAT-00", "SAT-01", "GW-0")
    outage = next(item for item in result.outages if item.start_s == 60)
    assert (outage.end_s, outage.duration_s) == (180, 120)
    assert outage.truncated_by_horizon is False
    assert outage.primary_cause is OutageCause.NO_CLIENT_COVERAGE
    assert outage.last_path == working_path
    assert outage.next_path == working_path
    tail = next(item for item in result.outages if item.start_s == 240)
    assert tail.truncated_by_horizon is True
    assert tail.primary_cause is OutageCause.NETWORK_PARTITION
    assert tail.next_path is None
    metrics = result.clients[0]
    assert metrics.max_gap_s == 120
    assert metrics.availability == pytest.approx(0.4)
    assert metrics.outage_count_by_cause == {
        OutageCause.NO_CLIENT_COVERAGE: 1,
        OutageCause.NETWORK_PARTITION: 1,
    }


def test_interval_causes_collect_every_tick() -> None:
    """Причина, возникшая в середине перерыва, попадает в `causes`, но не в основную."""
    links = ((0, 1, 500.0), (0, 3, 800.0), (1, 2, 900.0))
    plan = scripted_plan(
        satellite_count=2,
        gateway_count=1,
        client_count=1,
        links=links,
        present=((True, True, True), (False, True, True), (True, False, True)),
        gateway_available=[[True]] * 3,
    )
    result = aggregate(
        plan, route_all(plan, RoutingPolicy.BFS_SHORTEST), target_availability=0.9
    )
    outage = next(item for item in result.outages if item.start_s == 120)
    assert outage.primary_cause is OutageCause.NETWORK_PARTITION
    assert outage.causes == (OutageCause.NETWORK_PARTITION, OutageCause.NO_CLIENT_COVERAGE)


def test_backup_path_count_min_counts_disjoint_routes() -> None:
    """Два независимых маршрута дают резервирование 2; дешёвая оценка при этом не срабатывает."""
    links = (
        (0, 2, 500.0),
        (1, 3, 500.0),
        (0, 5, 800.0),
        (1, 5, 800.0),
        (2, 4, 900.0),
        (3, 4, 900.0),
    )
    plan = scripted_plan(
        satellite_count=4,
        gateway_count=1,
        client_count=1,
        links=links,
        present=((True,) * 6,),
        gateway_available=[[True]],
    )
    routes = route_all(plan, RoutingPolicy.BFS_SHORTEST)
    result = aggregate(plan, routes, target_availability=0.9)
    assert result.config.backup_path_count_min == 2
    assert disjoint_paths(plan, 0, CLIENT)[0] == 2


def test_backup_path_count_min_uses_exact_shortcut_on_bottleneck() -> None:
    """Единственный видимый клиенту аппарат делает резервирование единичным без max-flow."""
    links = (
        (0, 1, 500.0),
        (0, 2, 500.0),
        (0, 4, 800.0),
        (1, 3, 900.0),
        (2, 3, 900.0),
    )
    plan = scripted_plan(
        satellite_count=3,
        gateway_count=1,
        client_count=1,
        links=links,
        present=((True,) * 5,),
        gateway_available=[[True]],
    )
    routes = route_all(plan, RoutingPolicy.BFS_SHORTEST)
    assert aggregate(plan, routes, target_availability=0.9).config.backup_path_count_min == 1
    assert disjoint_paths(plan, 0, CLIENT)[0] == 1


def test_backup_paths_can_be_switched_off() -> None:
    result = _result(SCENARIOS_DIR / "01_full_constellation.json", False)
    assert result.config.backup_path_count_min is None
    assert _result(SCENARIOS_DIR / "01_full_constellation.json", True).config.backup_path_count_min


def test_metrics_without_any_path() -> None:
    """Клиент без единого маршрута: перерыв на весь горизонт, число переходов отсутствует."""
    links = ((0, 1, 500.0), (0, 3, 800.0), (1, 2, 900.0))
    plan = scripted_plan(
        satellite_count=2,
        gateway_count=1,
        client_count=1,
        links=links,
        present=((True, True, False), (True, True, False)),
        gateway_available=[[True], [True]],
    )
    result = aggregate(
        plan, route_all(plan, RoutingPolicy.BFS_SHORTEST), target_availability=0.9
    )
    metrics = result.clients[0]
    assert metrics.availability == 0.0
    assert metrics.mean_hops is None
    assert metrics.max_hops is None
    assert metrics.target_met is False
    assert result.config.mean_hops is None
    assert result.config.backup_path_count_min is None
    assert len(result.outages) == 1
    assert result.outages[0].truncated_by_horizon is True


@given(st.lists(st.booleans(), min_size=1, max_size=200))
def test_outage_runs_match_naive_scan(values: list[bool]) -> None:
    """Перерывы и самый долгий из них совпадают с прямым просмотром последовательности."""
    mask = np.array(values, dtype=np.bool_)
    runs = outage_runs(mask)
    longest = 0
    current = 0
    for value in values:
        current = 0 if value else current + 1
        longest = max(longest, current)
    assert longest_gap_ticks(mask) == longest
    assert sum(stop - start for start, stop in runs) == values.count(False)
    for start, stop in runs:
        assert start < stop
        assert not mask[start:stop].any()
        # Максимальность: перерыв нельзя расширить ни влево, ни вправо.
        assert start == 0 or bool(mask[start - 1])
        assert stop == len(values) or bool(mask[stop])
    assert all(previous[1] < nxt[0] for previous, nxt in pairwise(runs))
