"""Список смежности, Union-Find и компоненты связности графа отсчёта."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from orbita_core import contacts, graph, scenario
from orbita_core.contacts import ContactPlan
from tests.support import SCENARIO_PATHS, single_tick_plan, synthetic_scenario

# Отсчёты, на которых проверяются структурные свойства графа: начало сетки, ранняя четверть,
# середина суток и последний отсчёт горизонта.
SAMPLE_TICKS = (0, 180, 360, 719)


def _plan(path: Path) -> ContactPlan:
    return contacts.build(scenario.load(path))


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_adjacency_lists_exactly_existing_edges(path: Path) -> None:
    plan = _plan(path)
    for tick in SAMPLE_TICKS:
        adjacency = graph.build_adjacency(plan, tick)
        expected = np.flatnonzero(graph.usable_edge_mask(plan, tick)).tolist()
        # Каждое ребро отсчёта попадает в список смежности ровно дважды: по разу на конец.
        assert sorted(adjacency.edge_ids) == sorted(expected + expected)
        assert adjacency.offsets[-1] == len(adjacency.targets)


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_adjacency_is_symmetric_and_sorted(path: Path) -> None:
    plan = _plan(path)
    for tick in SAMPLE_TICKS:
        adjacency = graph.build_adjacency(plan, tick)
        pairs: set[tuple[int, int, int]] = set()
        for node in range(adjacency.node_count):
            neighbors = adjacency.neighbors(node)
            assert [other for other, _ in neighbors] == sorted(other for other, _ in neighbors)
            for other, edge in neighbors:
                pairs.add((node, other, edge))
        for node, other, edge in pairs:
            assert (other, node, edge) in pairs


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_clients_are_isolated_components(path: Path) -> None:
    plan = _plan(path)
    for tick in SAMPLE_TICKS:
        labels = graph.components(plan, tick)
        client_labels = [labels[plan.node_index[client]] for client in plan.client_ids]
        assert len(set(client_labels)) == len(client_labels)
        # Клиент не транзитный, поэтому его метка не встречается ни у одного другого узла.
        for label in client_labels:
            assert labels.count(label) == 1


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_component_ids_cover_satellites(path: Path) -> None:
    plan = _plan(path)
    labels = graph.component_ids(plan, SAMPLE_TICKS[0])
    assert len(labels) == plan.satellite_count
    assert labels == tuple(graph.components(plan, SAMPLE_TICKS[0])[: plan.satellite_count])


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_linked_satellites_share_component(path: Path) -> None:
    plan = _plan(path)
    for tick in SAMPLE_TICKS:
        labels = graph.components(plan, tick)
        for first, second in plan.edges[plan.edges_at(tick)].tolist():
            if second < plan.satellite_count:
                assert labels[first] == labels[second]


def test_union_find_merges_by_size() -> None:
    union_find = graph.UnionFind(6)
    union_find.union(0, 1)
    union_find.union(2, 3)
    union_find.union(1, 3)
    labels = union_find.labels()
    assert labels[0] == labels[1] == labels[2] == labels[3]
    assert len({labels[0], labels[4], labels[5]}) == 3


def test_unavailable_gateway_is_not_an_endpoint() -> None:
    """Недоступный шлюз не завершает маршрут даже при существующем ребре.

    Проверка нужна отдельно от контакт-плана: он снимает рёбра недоступного шлюза, но
    `available_gateway_nodes` обязан отсекать шлюз независимо, иначе ошибка в одном месте
    осталась бы незамеченной.
    """
    plan = single_tick_plan(
        satellite_count=1,
        gateway_count=1,
        client_count=1,
        links=[(0, 1, 900.0), (0, 2, 900.0)],
        gateway_available=[False],
    )
    assert graph.available_gateway_nodes(plan, 0) == ()
    assert not graph.reachable_unionfind(plan, 0, "TRM-0")


def test_reachability_follows_gateway_outage() -> None:
    data = synthetic_scenario(
        horizon_s=3600,
        gateway_outages=[{"gateway_id": "GW-NORTH", "start_s": 1200, "end_s": 2400}],
    )
    plan = contacts.build(scenario.parse(data))
    outage_ticks = [tick for tick in range(plan.ticks) if 1200 <= tick * plan.step_s < 2400]
    assert outage_ticks
    for tick in outage_ticks:
        assert not graph.reachable_unionfind(plan, tick, "TERM-EAST")
