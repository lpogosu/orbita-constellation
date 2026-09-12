"""Мосты, точки сочленения и контрфактическая критичность аппаратов.

Структурные величины сверяются с NetworkX: он не участвует в расчёте и реализует те же
определения другим алгоритмом, поэтому расхождение означает ошибку ядра, а не другой
взгляд на граф. Сама критичность проверяется на сценарии, топология которого известна
заранее: цепочка «клиент — аппарат — аппарат — шлюз», где средний аппарат обязан
оказаться единственной точкой отказа.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable
from typing import Any, Final

import networkx as nx
import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from numpy.typing import NDArray

from orbita_core import contacts, geometry, graph, resilience, scenario
from orbita_core.contacts import ContactPlan
from orbita_core.resilience import CriticalityCancelledError
from orbita_core.routing import RoutingPolicy, disjoint_paths
from tests.support import SCENARIOS_DIR, single_tick_plan, synthetic_scenario

POLICY: Final[RoutingPolicy] = RoutingPolicy.BFS_SHORTEST

# Отсчёты сценария кейса, на которых сверяется разложение графа: начало сетки, ранняя
# четверть, середина суток и последний отсчёт горизонта.
SAMPLE_TICKS: Final[tuple[int, ...]] = (0, 180, 360, 719)

# Угол возвышения, при котором пункт видит только аппарат почти над собой: так топология
# синтетического сценария задаётся выбором координат, а не подбором момента времени.
NADIR_ELEVATION_DEG: Final[float] = 80.0


def _network_graph(plan: ContactPlan, tick: int) -> nx.Graph:
    """Тот же граф отсчёта без клиентских рёбер, собранный независимо от ядра."""
    clients = {plan.node_index[client_id] for client_id in plan.client_ids}
    network = nx.Graph()
    network.add_nodes_from(plan.nodes)
    for first, second in plan.edges[np.flatnonzero(graph.usable_edge_mask(plan, tick))].tolist():
        if first not in clients and second not in clients:
            network.add_edge(plan.nodes[first], plan.nodes[second])
    return network


def _named_bridges(edges: Iterable[Iterable[str]]) -> list[tuple[str, ...]]:
    """Мосты в виде, не зависящем от порядка обхода: пары и список упорядочены по имени."""
    return sorted(tuple(sorted(edge)) for edge in edges)


def _named_components(components: Iterable[Iterable[str]]) -> list[list[str]]:
    return sorted(sorted(component) for component in components)


@st.composite
def _sparse_plans(draw: st.DrawFn) -> ContactPlan:
    """Разреженный граф на одном отсчёте: 4–10 узлов, каждая линия с вероятностью 1/3.

    Разреженность здесь не украшение: в графе, где присутствует половина возможных линий,
    мостов почти не бывает, и проверка выродилась бы в сравнение двух пустых списков.
    """
    satellite_count = draw(st.integers(min_value=2, max_value=6))
    gateway_count = draw(st.integers(min_value=1, max_value=2))
    client_count = draw(st.integers(min_value=1, max_value=2))
    present = st.integers(min_value=0, max_value=2).map(lambda value: value == 0)
    links: list[tuple[int, int, float]] = []
    for first in range(satellite_count):
        for second in range(first + 1, satellite_count + gateway_count + client_count):
            if draw(present):
                links.append((first, second, 1000.0))
    return single_tick_plan(
        satellite_count=satellite_count,
        gateway_count=gateway_count,
        client_count=client_count,
        links=links,
        gateway_available=[draw(st.booleans()) for _ in range(gateway_count)],
    )


@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(plan=_sparse_plans())
def test_decomposition_matches_networkx(plan: ContactPlan) -> None:
    """Мосты, точки сочленения и двусвязные компоненты совпадают с независимым оракулом."""
    network = _network_graph(plan, 0)

    assert _named_bridges(graph.bridges(plan, 0)) == _named_bridges(nx.bridges(network))
    assert graph.articulation_points(plan, 0) == set(nx.articulation_points(network))
    assert _named_components(graph.biconnected_components(plan, 0)) == _named_components(
        nx.biconnected_components(network)
    )


@pytest.mark.parametrize("tick", SAMPLE_TICKS)
def test_decomposition_matches_networkx_on_the_case_scenario(tick: int) -> None:
    """Тот же оракул на настоящей группировке, а не только на случайных графах."""
    plan = contacts.build(scenario.load(SCENARIOS_DIR / "01_full_constellation.json"))
    network = _network_graph(plan, tick)

    assert _named_bridges(graph.bridges(plan, tick)) == _named_bridges(nx.bridges(network))
    assert graph.articulation_points(plan, tick) == set(nx.articulation_points(network))
    assert _named_components(graph.biconnected_components(plan, tick)) == _named_components(
        nx.biconnected_components(network)
    )


def test_client_links_are_not_bridges() -> None:
    """Подключение клиента не создаёт моста: клиент не транзитный узел (ADR-002).

    Линия «клиент — аппарат» формально разъединяет граф, но её потеря отключает одного
    потребителя, а не разрывает сеть, и в список уязвимостей попадать не должна.
    """
    plan = single_tick_plan(
        satellite_count=2,
        gateway_count=1,
        client_count=1,
        # Аппараты связаны друг с другом и со шлюзом, клиент подключён к одному из них.
        links=[(0, 1, 1000.0), (0, 2, 1000.0), (1, 2, 1000.0), (0, 3, 1000.0)],
        gateway_available=[True],
    )

    assert graph.bridges(plan, 0) == []
    assert graph.articulation_points(plan, 0) == set()


def _subsatellite_point(position: NDArray[np.float64]) -> tuple[float, float]:
    """Широта и долгота точки под аппаратом в земной системе."""
    radius = float(np.linalg.norm(position))
    return (
        math.degrees(math.asin(float(position[2]) / radius)),
        math.degrees(math.atan2(float(position[1]), float(position[0]))),
    )


def _chain_scenario() -> dict[str, Any]:
    """Сценарий «клиент — SAT-B — SAT-A — шлюз» на одном отсчёте.

    Пункты ставятся ровно под своими аппаратами, а минимальный угол возвышения поднят до
    почти надирного: тогда каждый пункт видит один-единственный аппарат, и топология сети
    известна точно, без подбора момента времени. Аппараты разнесены на 20° по одной
    орбите — это ближе дальности межспутниковой линии и достаточно, чтобы зоны видимости
    пунктов не пересекались.
    """
    draft: dict[str, Any] = {
        "schema_version": "cosmo-A-1.0",
        "meta": {"id": "chain", "title": "Цепочка из двух аппаратов"},
        "environment": {
            "altitude_km": 550.0,
            "inclination_deg": 87.0,
            "earth_angle0_deg": 0.0,
            "horizon_s": 120,
            "step_s": 120,
            "min_elevation_deg": NADIR_ELEVATION_DEG,
            "isl_range_km": 3000.0,
            "target_availability": 0.9,
        },
        "design": {
            "launch_stage": 1,
            "planes": [{"id": "ORB", "raan_deg": 0.0, "phase_deg": 0.0}],
            "satellites": [
                {"id": "SAT-A", "plane_id": "ORB", "slot_deg": 0.0, "launch_batch": 1},
                {"id": "SAT-B", "plane_id": "ORB", "slot_deg": 20.0, "launch_batch": 1},
            ],
        },
        "ground_sites": [
            {"id": "GW", "name": "Шлюз", "role": "gateway", "lat_deg": 0.0, "lon_deg": 0.0},
            {"id": "TRM", "name": "Терминал", "role": "client", "lat_deg": 0.0, "lon_deg": 0.0},
        ],
        "failures": [],
        "gateway_outages": [],
    }
    positions = geometry.positions_all(scenario.parse(draft))[0]
    for site, position in zip(draft["ground_sites"], positions, strict=True):
        site["lat_deg"], site["lon_deg"] = _subsatellite_point(position)
    return draft


def test_chain_topology_is_a_single_bridge() -> None:
    """Предпосылка остальных проверок: сеть сценария — цепочка с одной точкой отказа."""
    plan = contacts.build(scenario.parse(_chain_scenario()))

    assert graph.bridges(plan, 0) == [("SAT-A", "SAT-B"), ("SAT-A", "GW")]
    assert graph.articulation_points(plan, 0) == {"SAT-A"}
    assert graph.biconnected_components(plan, 0) == [{"SAT-A", "SAT-B"}, {"SAT-A", "GW"}]


def test_bridge_satellite_is_the_critical_one() -> None:
    """Аппарат-мост теряет клиенту связь целиком и разделяет сеть на каждом отсчёте."""
    report = resilience.criticality(_chain_scenario(), POLICY)
    by_id = {entry.satellite_id: entry for entry in report.satellites}

    assert report.base.min_client_availability == 1.0
    assert by_id["SAT-A"].delta_min_client_availability == -1.0
    assert by_id["SAT-A"].affected_clients == ("TRM",)
    assert by_id["SAT-A"].articulation_frequency == 1.0
    assert by_id["SAT-A"].plane_id == "ORB"
    # Крайний аппарат цепочки тоже нужен клиенту — он его единственный вход в сеть, — но
    # сеть без него не распадается, и точкой сочленения он не является.
    assert by_id["SAT-B"].delta_min_client_availability == -1.0
    assert by_id["SAT-B"].articulation_frequency == 0.0


def test_chain_satellite_is_always_in_the_minimal_cut() -> None:
    """Единственный маршрут держится на аппарате входа, и он входит в разрез всегда.

    Минимальный разрез в цепочке не один: убрать достаточно любого из двух аппаратов.
    Поиск возвращает ближайший к клиенту — тот, что стоит на стороне истока потока, — и
    это устойчивый выбор, а не случайный, поэтому проверяется именно он.
    """
    report = resilience.criticality(_chain_scenario(), POLICY)
    by_id = {entry.satellite_id: entry for entry in report.satellites}

    assert by_id["SAT-B"].min_cut_frequency == 1.0


def test_minimal_cut_satellites_have_positive_frequency() -> None:
    """На сценарии со скрытой проверкой аппараты разреза видны в отчёте.

    Разрез считается прямо здесь, независимо от отчёта, и только найденные в нём аппараты
    идут в прогон: полный прогон по всей группировке этой проверке ничего не добавит, а
    стоит секунды.
    """
    hidden = scenario.load(SCENARIOS_DIR / "hidden_like.json")
    plan = contacts.build(hidden)
    tick = plan.ticks // 2
    in_cut = {
        satellite_id
        for client in plan.client_ids
        for satellite_id in disjoint_paths(plan, tick, client)[2]
    }
    assert in_cut, "на середине горизонта разрез пуст, проверять нечего"

    report = resilience.criticality(hidden, POLICY, satellites=sorted(in_cut))

    assert {entry.satellite_id for entry in report.satellites} == in_cut
    for entry in report.satellites:
        assert entry.min_cut_frequency > 0.0


def test_failure_never_improves_the_configuration() -> None:
    """Инвариант 8: отказ аппарата не поднимает доступность и не сокращает перерыв."""
    report = resilience.criticality(synthetic_scenario(satellite_count=6, horizon_s=3600), POLICY)

    assert report.satellites
    for entry in report.satellites:
        assert entry.delta_min_client_availability <= 0.0
        assert entry.delta_worst_max_gap_s >= 0


def test_most_critical_satellite_comes_first() -> None:
    """Порядок отчёта — от самого критичного аппарата к безразличному."""
    report = resilience.criticality(synthetic_scenario(satellite_count=6, horizon_s=3600), POLICY)
    keys = [
        (entry.delta_min_client_availability, -entry.delta_worst_max_gap_s, entry.satellite_id)
        for entry in report.satellites
    ]

    assert keys == sorted(keys)


def test_report_carries_the_base_it_was_measured_against() -> None:
    """Дельты без базы не читаются, поэтому отчёт несёт и метрики исходной конфигурации."""
    report = resilience.criticality(synthetic_scenario(satellite_count=4, horizon_s=1200), POLICY)

    assert report.routing_policy is POLICY
    assert report.engine_version
    assert report.config_hash
    assert 0.0 <= report.base.min_client_availability <= 1.0


def test_cancel_check_stops_after_the_current_satellite() -> None:
    """Отмена прерывает прогон исключением, а не укороченным отчётом."""
    calls: list[int] = []

    def cancelled() -> bool:
        calls.append(len(calls))
        return len(calls) > 2

    with pytest.raises(CriticalityCancelledError):
        resilience.criticality(
            synthetic_scenario(satellite_count=6, horizon_s=1200),
            POLICY,
            cancel_check=cancelled,
        )

    assert len(calls) == 3


def test_progress_counts_every_satellite() -> None:
    """Прогресс идёт от нуля до полного числа аппаратов без пропусков."""
    seen: list[tuple[int, int]] = []

    report = resilience.criticality(
        synthetic_scenario(satellite_count=4, horizon_s=1200),
        POLICY,
        progress=lambda done, total: seen.append((done, total)),
    )

    total = len(report.satellites)
    assert seen == [(done, total) for done in range(total + 1)]


def test_inactive_satellites_are_skipped() -> None:
    """Аппарат, не выведенный на орбиту, в прогон не идёт: его отказ ничего не меняет."""
    report = resilience.criticality(
        synthetic_scenario(
            satellite_count=4,
            launch_batches=[1, 1, 2, 2],
            launch_stage=1,
            horizon_s=1200,
        ),
        POLICY,
    )

    assert {entry.satellite_id for entry in report.satellites} == {"SAT-00", "SAT-01"}


def test_unknown_satellite_is_rejected() -> None:
    """Опечатка в списке аппаратов не должна молча превращаться в пустой отчёт."""
    with pytest.raises(ValueError, match="NOT-A-SAT"):
        resilience.criticality(
            synthetic_scenario(satellite_count=3, horizon_s=1200),
            POLICY,
            satellites=["NOT-A-SAT"],
        )


def test_raw_json_gives_the_same_report_as_a_parsed_scenario() -> None:
    """Ядро принимает и разобранный сценарий, и сырой JSON: у HTTP-слоя на входе словарь."""
    path = SCENARIOS_DIR / "01_full_constellation.json"
    parsed = scenario.load(path)
    first = parsed.satellites[0].id

    from_object = resilience.criticality(parsed, POLICY, satellites=[first])
    from_mapping = resilience.criticality(
        json.loads(path.read_text(encoding="utf-8")), POLICY, satellites=[first]
    )

    # Длительность прогона в отчёте своя у каждого запуска, всё остальное обязано совпасть.
    assert from_object.satellites == from_mapping.satellites
    assert from_object.config_hash == from_mapping.config_hash
    assert from_object.base == from_mapping.base
