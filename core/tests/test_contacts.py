"""Contact plan: активность аппаратов, границы интервалов и состав рёбер."""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from orbita_core import contacts, geometry
from orbita_core.contacts import ContactPlan, EdgeKind
from orbita_core.scenario import parse
from tests.support import synthetic_scenario


def _neighbours(plan: ContactPlan, tick: int, node_id: str) -> set[str]:
    """Соседи узла на отсчёте по идентификаторам, а не по индексам рёбер.

    Индексы зависят от состава плана, поэтому два плана сравниваются только по именам.
    """
    node = plan.node_index[node_id]
    neighbours: set[str] = set()
    for index in plan.edges_at(tick):
        first, second = int(plan.edges[index, 0]), int(plan.edges[index, 1])
        if first == node:
            neighbours.add(plan.nodes[second])
        elif second == node:
            neighbours.add(plan.nodes[first])
    return neighbours


def _ground_edge_count(plan: ContactPlan, tick: int) -> int:
    return sum(1 for index in plan.edges_at(tick) if plan.kinds[index] is EdgeKind.GROUND)


def _isl_edge_count(plan: ContactPlan, tick: int) -> int:
    return sum(1 for index in plan.edges_at(tick) if plan.kinds[index] is EdgeKind.ISL)


def test_failure_interval_is_half_open() -> None:
    """Отказ `[a; b)`: аппарат исключён при `t = a` и снова работает при `t = b`."""
    scenario = parse(
        synthetic_scenario(failures=[{"satellite_id": "SAT-00", "start_s": 240.0, "end_s": 480.0}])
    )
    plan = contacts.build(scenario)
    satellite = plan.node_index["SAT-00"]
    assert bool(plan.active[1, satellite]) is True
    assert bool(plan.active[2, satellite]) is False
    assert bool(plan.active[3, satellite]) is False
    assert bool(plan.active[4, satellite]) is True
    assert _neighbours(plan, 2, "SAT-00") == set()


def test_inactive_satellite_keeps_its_position() -> None:
    """Инвариант 14: отказавший аппарат остаётся на орбите, но выпадает из рёбер."""
    data = synthetic_scenario(
        failures=[{"satellite_id": "SAT-00", "start_s": 0.0, "end_s": 7200.0}]
    )
    scenario = parse(data)
    plan = contacts.build(scenario)
    healthy = parse(synthetic_scenario())
    assert np.allclose(plan.positions, geometry.positions_all(healthy))
    assert not plan.active[:, plan.node_index["SAT-00"]].any()
    assert all(_neighbours(plan, tick, "SAT-00") == set() for tick in range(plan.ticks))


def test_launch_stage_activates_only_launched_batches() -> None:
    """Инвариант 15: при `launch_stage = 1` активны ровно аппараты первой очереди."""
    scenario = parse(
        synthetic_scenario(satellite_count=6, launch_batches=[1, 2, 3, 1, 2, 3], launch_stage=1)
    )
    plan = contacts.build(scenario)
    active_ids = {
        plan.nodes[index] for index in range(plan.satellite_count) if bool(plan.active[0, index])
    }
    assert active_ids == {"SAT-00", "SAT-03"}
    assert plan.active.all(axis=0).sum() == 2


def test_near_vertical_elevation_leaves_no_ground_edges() -> None:
    """Инвариант 16: с почти вертикальным порогом наземных контактов не остаётся.

    Ровно 90° спецификация запрещает (`01_SPEC.md` §3.1: порог из [0; 90)), поэтому
    берётся ближайшее допустимое значение.
    """
    scenario = parse(synthetic_scenario(min_elevation_deg=89.999))
    plan = contacts.build(scenario)
    assert all(_ground_edge_count(plan, tick) == 0 for tick in range(plan.ticks))


def test_vanishing_isl_range_leaves_no_isl_edges() -> None:
    """Инвариант 16: при дальности, стремящейся к нулю, межспутниковых линий нет."""
    scenario = parse(synthetic_scenario(isl_range_km=1e-6))
    plan = contacts.build(scenario)
    assert all(_isl_edge_count(plan, tick) == 0 for tick in range(plan.ticks))
    assert any(_ground_edge_count(plan, tick) > 0 for tick in range(plan.ticks))


def test_gateway_outage_removes_gateway_edges_only_inside_the_interval() -> None:
    """Недоступный шлюз теряет рёбра ровно на своих отсчётах, остальные не меняются."""
    outage_start_tick, outage_end_tick = 10, 20
    baseline = contacts.build(parse(synthetic_scenario()))
    plan = contacts.build(
        parse(
            synthetic_scenario(
                gateway_outages=[{"gateway_id": "GW-NORTH", "start_s": 1200.0, "end_s": 2400.0}]
            )
        )
    )
    visible_before_outage = [
        tick
        for tick in range(outage_start_tick, outage_end_tick)
        if _neighbours(baseline, tick, "GW-NORTH")
    ]
    assert visible_before_outage, "сценарий теста должен покрывать шлюз в этом окне"
    assert all(
        _neighbours(plan, tick, "GW-NORTH") == set()
        for tick in range(outage_start_tick, outage_end_tick)
    )
    assert not plan.is_gateway_available(outage_start_tick, "GW-NORTH")
    assert plan.is_gateway_available(outage_end_tick, "GW-NORTH")
    assert all(
        _neighbours(plan, tick, "GW-NORTH") == _neighbours(baseline, tick, "GW-NORTH")
        for tick in range(outage_end_tick, plan.ticks)
    )


def test_gateway_outage_does_not_touch_client_visibility() -> None:
    """Недоступность объявляется только для шлюзов: клиент продолжает видеть аппараты."""
    scenario = parse(
        synthetic_scenario(
            gateway_outages=[{"gateway_id": "GW-NORTH", "start_s": 0.0, "end_s": 7200.0}]
        )
    )
    plan = contacts.build(scenario)
    assert plan.gateway_ids == ("GW-NORTH",)
    assert not plan.gateway_available.any()
    assert any(plan.client_visible(tick, "TERM-EAST") for tick in range(plan.ticks))


def test_plan_covers_exactly_the_time_grid() -> None:
    """Инвариант 11: `t = 0` рассчитывается, `t = horizon_s` — нет."""
    scenario = parse(synthetic_scenario(horizon_s=1200, step_s=120))
    plan = contacts.build(scenario)
    assert plan.ticks == 10
    assert plan.bits.shape[0] == 10
    assert plan.dist.shape == plan.bits.shape


def test_client_visible_returns_satellites_of_existing_edges() -> None:
    """`client_visible` показывает ровно те аппараты, с которыми есть ребро."""
    scenario = parse(synthetic_scenario())
    plan = contacts.build(scenario)
    for tick in range(plan.ticks):
        visible = plan.client_visible(tick, "TERM-EAST")
        assert set(visible) <= set(plan.satellite_ids)
        assert set(visible) == _neighbours(plan, tick, "TERM-EAST")


@settings(max_examples=25, deadline=None)
@given(
    satellite_count=st.integers(min_value=2, max_value=6),
    isl_range_km=st.floats(min_value=500.0, max_value=6000.0),
    min_elevation_deg=st.floats(min_value=0.0, max_value=45.0),
    launch_stage=st.integers(min_value=1, max_value=3),
)
def test_contact_plan_invariants(
    satellite_count: int, isl_range_km: float, min_elevation_deg: float, launch_stage: int
) -> None:
    """Структурные инварианты плана на случайных малых сценариях.

    Ребро хранится один раз в виде упорядоченной пары, существует хотя бы на одном
    отсчёте, имеет положительную длину и соединяет только работающие узлы.
    """
    scenario = parse(
        synthetic_scenario(
            satellite_count=satellite_count,
            launch_batches=[(index % 3) + 1 for index in range(satellite_count)],
            launch_stage=launch_stage,
            isl_range_km=isl_range_km,
            min_elevation_deg=min_elevation_deg,
            horizon_s=3600,
        )
    )
    plan = contacts.build(scenario)

    assert (plan.edges[:, 0] < plan.edges[:, 1]).all()
    assert len({(int(a), int(b)) for a, b in plan.edges}) == plan.edge_count
    assert plan.bits.any(axis=0).all()
    assert (plan.dist[plan.bits] > 0.0).all()

    for tick in range(plan.ticks):
        for index in plan.edges_at(tick):
            first, second = int(plan.edges[index, 0]), int(plan.edges[index, 1])
            assert bool(plan.active[tick, first])
            if plan.kinds[index] is EdgeKind.ISL:
                assert second < plan.satellite_count
                assert bool(plan.active[tick, second])
                assert plan.dist[tick, index] < isl_range_km
            else:
                assert second >= plan.satellite_count
                site = plan.nodes[second]
                if site in plan.gateway_ids:
                    assert plan.is_gateway_available(tick, site)


@pytest.mark.parametrize("step_s", [60, 120, 300])
def test_tick_count_follows_step(step_s: int) -> None:
    """Число отсчётов определяется шагом, а не зашито в ядре."""
    scenario = parse(synthetic_scenario(horizon_s=1800, step_s=step_s))
    plan = contacts.build(scenario)
    assert plan.ticks == 1800 // step_s
