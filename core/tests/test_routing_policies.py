"""Три политики маршрутизации, резервные пути и инварианты `10_FIXTURES.md` §2.

Инварианты 1–6 и 19 проверяются на всех сценариях каталога `scenarios/`, включая
`hidden_like.json` с другими идентификаторами и недоступностью шлюза (ADR-015). Оракулом
для случайных графов служит NetworkX: он используется только здесь, ядро на него не
ссылается.
"""

from __future__ import annotations

from dataclasses import replace
from functools import cache
from itertools import pairwise
from pathlib import Path

import networkx as nx
import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from orbita_core import contacts, graph, scenario
from orbita_core.contacts import ContactPlan
from orbita_core.routing import (
    RouteTable,
    RoutingPolicy,
    disjoint_paths,
    route_all,
    route_tick,
)
from tests.support import SCENARIO_PATHS, single_tick_plan, synthetic_scenario

# `mean_hops` по `bfs_shortest` из `10_FIXTURES.md` §1, допуск ±0,01.
GOLDEN_MEAN_HOPS: dict[str, dict[str, float]] = {
    "01_full_constellation": {"C65": 2.29, "C70": 2.66, "C72": 3.15},
    "02_first_launch": {"C65": 2.07, "C70": 2.14, "C72": 3.12},
    "03_satellite_outages": {"C65": 2.35, "C70": 2.77, "C72": 3.28},
    "04_link_range": {"C65": 2.07, "C70": 2.38, "C72": 3.36},
}

# Узел-сток оракула: все доступные шлюзы стягиваются в него, потому что маршруты обязаны не
# пересекаться по аппаратам, а шлюз общим быть может.
SINK = "__sink__"


@cache
def _plan(path: Path) -> ContactPlan:
    return contacts.build(scenario.load(path))


@cache
def _table(path: Path, policy: RoutingPolicy) -> RouteTable:
    return route_all(_plan(path), policy)


@cache
def _edge_of_pair(path: Path) -> dict[tuple[str, str], int]:
    plan = _plan(path)
    return {
        (plan.nodes[first], plan.nodes[second]): index
        for index, (first, second) in enumerate(plan.edges.tolist())
    }


def _plan_without(plan: ContactPlan, removed: tuple[str, ...]) -> ContactPlan:
    """Тот же план без рёбер перечисленных аппаратов: модель их одновременного отказа."""
    nodes = np.array([plan.node_index[node_id] for node_id in removed], dtype=np.int64)
    touched = np.isin(plan.edges, nodes).any(axis=1)
    bits = plan.bits.copy()
    bits[:, touched] = False
    return replace(plan, bits=bits)


@pytest.mark.parametrize("policy", list(RoutingPolicy), ids=lambda item: item.value)
@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_path_edges_exist_on_their_tick(path: Path, policy: RoutingPolicy) -> None:
    """Инвариант 1: каждое ребро маршрута существует в графе своего отсчёта."""
    plan = _plan(path)
    table = _table(path, policy)
    edge_of_pair = _edge_of_pair(path)
    for client in plan.client_ids:
        for tick, route in enumerate(table.paths[client]):
            if route is None:
                continue
            for first, second in pairwise(route):
                edge = edge_of_pair.get((first, second), edge_of_pair.get((second, first)))
                assert edge is not None, f"ребра {first}—{second} нет в contact plan"
                assert plan.bits[tick, edge]


@pytest.mark.parametrize("policy", list(RoutingPolicy), ids=lambda item: item.value)
@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_path_endpoints_and_transit_nodes(path: Path, policy: RoutingPolicy) -> None:
    """Инвариант 2: клиент в начале, доступный шлюз в конце, между ними активные аппараты."""
    plan = _plan(path)
    table = _table(path, policy)
    clients = frozenset(plan.client_ids)
    for client in plan.client_ids:
        for tick, route in enumerate(table.paths[client]):
            if route is None:
                continue
            assert route[0] == client
            assert route[-1] in plan.gateway_ids
            assert plan.is_gateway_available(tick, route[-1])
            for node_id in route[1:-1]:
                index = plan.node_index[node_id]
                assert index < plan.satellite_count
                assert plan.active[tick, index]
                assert node_id not in clients


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_bfs_reachability_matches_union_find(path: Path) -> None:
    """Инвариант 3: обход в ширину и Union-Find согласуются на каждом `(t, client)`."""
    plan = _plan(path)
    table = _table(path, RoutingPolicy.BFS_SHORTEST)
    for client in plan.client_ids:
        for tick in range(plan.ticks):
            found = table.paths[client][tick] is not None
            assert found == graph.reachable_unionfind(plan, tick, client)


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_persistent_availability_matches_bfs(path: Path) -> None:
    """Инвариант 4: удержание маршрута не меняет доступность."""
    plan = _plan(path)
    shortest = _table(path, RoutingPolicy.BFS_SHORTEST)
    persistent = _table(path, RoutingPolicy.PERSISTENT)
    for client in plan.client_ids:
        assert np.array_equal(persistent.reachable(client), shortest.reachable(client))


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_persistent_switches_no_more_than_bfs(path: Path) -> None:
    """Инвариант 5: удержание маршрута не увеличивает число перестроений."""
    plan = _plan(path)
    shortest = _table(path, RoutingPolicy.BFS_SHORTEST)
    persistent = _table(path, RoutingPolicy.PERSISTENT)
    for client in plan.client_ids:
        assert persistent.route_switches[client] <= shortest.route_switches[client]


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_bfs_hops_no_more_than_dijkstra(path: Path) -> None:
    """Инвариант 6: минимум переходов не хуже кратчайшего по длине на каждом отсчёте."""
    plan = _plan(path)
    shortest = _table(path, RoutingPolicy.BFS_SHORTEST)
    weighted = _table(path, RoutingPolicy.DIJKSTRA_DISTANCE)
    for client in plan.client_ids:
        for tick in range(plan.ticks):
            by_hops = shortest.hops[client][tick]
            by_length = weighted.hops[client][tick]
            assert (by_hops is None) == (by_length is None)
            if by_hops is not None and by_length is not None:
                assert by_hops <= by_length


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_dijkstra_is_not_longer_in_km(path: Path) -> None:
    """Кратчайший по длине маршрут не длиннее найденного обходом в ширину."""
    plan = _plan(path)
    shortest = _table(path, RoutingPolicy.BFS_SHORTEST)
    weighted = _table(path, RoutingPolicy.DIJKSTRA_DISTANCE)
    for client in plan.client_ids:
        for tick in range(plan.ticks):
            by_hops = shortest.length_km[client][tick]
            by_length = weighted.length_km[client][tick]
            if by_hops is not None and by_length is not None:
                assert by_length <= by_hops + 1e-9


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_backup_path_count_follows_reachability(path: Path) -> None:
    """Инвариант 19: резервных путей не меньше одного там, где маршрут есть, и ноль иначе."""
    plan = _plan(path)
    table = _table(path, RoutingPolicy.BFS_SHORTEST)
    for tick in range(plan.ticks):
        for client in plan.client_ids:
            count, paths, min_cut = disjoint_paths(plan, tick, client)
            if table.paths[client][tick] is None:
                assert (count, paths, min_cut) == (0, [], ())
                continue
            assert count >= 1
            # Теорема Менгера: размер минимального вершинного разреза равен числу
            # непересекающихся путей, иначе разрез посчитан не по вершинам.
            assert len(min_cut) == count
            assert len(paths) == count
            used: set[str] = set()
            for route in paths:
                assert route[0] == client
                assert plan.is_gateway_available(tick, route[-1])
                transit = set(route[1:-1])
                assert not (transit & used)
                used |= transit


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_min_cut_really_disconnects(path: Path) -> None:
    """Снятие аппаратов минимального разреза лишает клиента маршрута."""
    plan = _plan(path)
    table = _table(path, RoutingPolicy.BFS_SHORTEST)
    checked = 0
    for tick in range(0, plan.ticks, 60):
        for client in plan.client_ids:
            if table.paths[client][tick] is None:
                continue
            _, _, min_cut = disjoint_paths(plan, tick, client)
            assert not graph.reachable_unionfind(_plan_without(plan, min_cut), tick, client)
            checked += 1
    assert checked > 0


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_gateway_outage_excludes_that_gateway(path: Path) -> None:
    """Недоступный шлюз не является концом маршрута ни на одном отсчёте отказа."""
    loaded = scenario.load(path)
    if not loaded.gateway_outages:
        pytest.skip("в сценарии нет недоступности шлюза")
    plan = _plan(path)
    table = _table(path, RoutingPolicy.BFS_SHORTEST)
    checked = 0
    for outage in loaded.gateway_outages:
        for tick, t_s in enumerate(loaded.times_s):
            if not outage.covers(float(t_s)):
                continue
            for client in plan.client_ids:
                route = table.paths[client][tick]
                checked += 1
                if route is not None:
                    assert route[-1] != outage.node_id
    assert checked > 0


def test_single_gateway_outage_leaves_no_path() -> None:
    """При единственном шлюзе его недоступность означает отсутствие маршрута.

    Сценарий синтетический: в каталоге `scenarios/` шлюз отказывает только там, где их
    несколько, и маршрут просто уходит на соседний.
    """
    data = synthetic_scenario(
        horizon_s=3600,
        gateway_outages=[{"gateway_id": "GW-NORTH", "start_s": 1200, "end_s": 2400}],
    )
    plan = contacts.build(scenario.parse(data))
    table = route_all(plan, RoutingPolicy.PERSISTENT)
    outage = [tick for tick in range(plan.ticks) if 1200 <= tick * plan.step_s < 2400]
    assert outage
    for tick in outage:
        assert table.paths["TERM-EAST"][tick] is None


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_client_is_never_a_transit_node(path: Path) -> None:
    """Клиентский пункт не ретранслирует ни при одной политике."""
    plan = _plan(path)
    clients = frozenset(plan.client_ids)
    for policy in RoutingPolicy:
        table = _table(path, policy)
        for client in plan.client_ids:
            for route in table.paths[client]:
                if route is not None:
                    assert not (clients & set(route[1:]))


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_routing_is_reproducible(path: Path) -> None:
    """Повторный запуск даёт те же маршруты: порядок обхода соседей фиксирован (ADR-011)."""
    plan = _plan(path)
    first = route_all(plan, RoutingPolicy.BFS_SHORTEST)
    second = route_all(plan, RoutingPolicy.BFS_SHORTEST)
    assert first.paths == second.paths
    assert first.route_switches == second.route_switches


@pytest.mark.parametrize(
    "policy",
    [RoutingPolicy.BFS_SHORTEST, RoutingPolicy.DIJKSTRA_DISTANCE],
    ids=lambda item: item.value,
)
@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_route_tick_matches_full_horizon(path: Path, policy: RoutingPolicy) -> None:
    """Маршрут одного отсчёта совпадает с тем же отсчётом полного расчёта.

    Обе политики без памяти, поэтому совпадение обязано быть на каждом отсчёте: именно на
    этом держится предварительный просмотр конфигурации.
    """
    plan = _plan(path)
    table = _table(path, policy)
    for tick in range(plan.ticks):
        assert route_tick(plan, tick, policy) == {
            client: table.paths[client][tick] for client in plan.client_ids
        }


@pytest.mark.parametrize("path", SCENARIO_PATHS, ids=lambda item: item.stem)
def test_route_tick_without_history_equals_bfs(path: Path) -> None:
    """`persistent` на одиночном отсчёте вырождается в поиск в ширину: удерживать нечего."""
    plan = _plan(path)
    tick = plan.ticks // 2
    assert route_tick(plan, tick, RoutingPolicy.PERSISTENT) == route_tick(
        plan, tick, RoutingPolicy.BFS_SHORTEST
    )


@pytest.mark.parametrize("stem", sorted(GOLDEN_MEAN_HOPS), ids=lambda item: str(item))
def test_mean_hops_matches_golden(stem: str) -> None:
    """`mean_hops` по `bfs_shortest` совпадает с `10_FIXTURES.md` §1."""
    path = next(item for item in SCENARIO_PATHS if item.stem == stem)
    table = _table(path, RoutingPolicy.BFS_SHORTEST)
    for client, expected in GOLDEN_MEAN_HOPS[stem].items():
        counted = [value for value in table.hops[client] if value is not None]
        assert counted
        assert sum(counted) / len(counted) == pytest.approx(expected, abs=0.01)


def _link_edge(target: nx.Graph, first: str, second: str, length: float) -> None:
    """Ребро оракула; при стягивании шлюзов в сток остаётся кратчайшая из линий."""
    if target.has_edge(first, second):
        target[first][second]["length"] = min(target[first][second]["length"], length)
    else:
        target.add_edge(first, second, length=length)


def _oracle_graph(plan: ContactPlan, client: str) -> nx.Graph:
    """Граф для NetworkX: аппараты, один клиент и сток над доступными шлюзами.

    Чужие клиенты не попадают в граф вовсе — это и есть запрет транзита через клиента.
    """
    oracle = nx.Graph()
    oracle.add_nodes_from(plan.satellite_ids)
    oracle.add_node(client)
    client_node = plan.node_index[client]
    available = set(graph.available_gateway_nodes(plan, 0))
    lengths = plan.dist[0].tolist()
    for index, (first, second) in enumerate(plan.edges.tolist()):
        length = lengths[index]
        if second < plan.satellite_count:
            _link_edge(oracle, plan.nodes[first], plan.nodes[second], length)
        elif second == client_node:
            _link_edge(oracle, client, plan.nodes[first], length)
        elif second in available:
            _link_edge(oracle, plan.nodes[first], SINK, length)
    return oracle


@st.composite
def _small_plans(draw: st.DrawFn) -> ContactPlan:
    """Случайный граф на одном отсчёте: 5–15 узлов, произвольные линии и доступность шлюзов."""
    satellite_count = draw(st.integers(min_value=3, max_value=8))
    gateway_count = draw(st.integers(min_value=1, max_value=2))
    client_count = draw(st.integers(min_value=1, max_value=3))
    lengths = st.floats(min_value=1.0, max_value=100.0, allow_nan=False, allow_infinity=False)
    links: list[tuple[int, int, float]] = []
    for first in range(satellite_count):
        for second in range(first + 1, satellite_count):
            if draw(st.booleans()):
                links.append((first, second, draw(lengths)))
    for site in range(gateway_count + client_count):
        for satellite in range(satellite_count):
            if draw(st.booleans()):
                links.append((satellite, satellite_count + site, draw(lengths)))
    return single_tick_plan(
        satellite_count=satellite_count,
        gateway_count=gateway_count,
        client_count=client_count,
        links=links,
        gateway_available=[draw(st.booleans()) for _ in range(gateway_count)],
    )


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(plan=_small_plans())
def test_random_graphs_match_networkx(plan: ContactPlan) -> None:
    """Достижимость, длина пути и число непересекающихся путей совпадают с NetworkX."""
    shortest = route_all(plan, RoutingPolicy.BFS_SHORTEST)
    weighted = route_all(plan, RoutingPolicy.DIJKSTRA_DISTANCE)
    for client in plan.client_ids:
        oracle = _oracle_graph(plan, client)
        connected = SINK in oracle and nx.has_path(oracle, client, SINK)
        route = shortest.paths[client][0]
        assert (route is not None) == connected

        count, paths, min_cut = disjoint_paths(plan, 0, client)
        if not connected:
            assert (count, paths, min_cut) == (0, [], ())
            continue

        assert shortest.hops[client][0] == nx.shortest_path_length(oracle, client, SINK)
        assert weighted.length_km[client][0] == pytest.approx(
            nx.shortest_path_length(oracle, client, SINK, weight="length")
        )
        assert count == nx.node_connectivity(oracle, client, SINK)
        assert len(min_cut) == count
        cut_away = oracle.copy()
        cut_away.remove_nodes_from(min_cut)
        assert not nx.has_path(cut_away, client, SINK)
