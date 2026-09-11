"""Поиск и обновление маршрутов клиент → шлюз, резервные пути и минимальный разрез.

Три стратегии ADR-003 работают на одном и том же графе отсчёта: различается только правило
выбора и обновления пути, поэтому их метрики сравнимы между собой. Клиентские пункты не
ретранслируют: из клиента выходим, в клиент не входим (`04_CORE.md` §1).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from heapq import heappop, heappush
from math import inf
from typing import Final

import numpy as np
from numpy.typing import NDArray

from orbita_core.contacts import ContactPlan
from orbita_core.graph import (
    Adjacency,
    available_gateway_nodes,
    build_adjacency,
    components,
    reachable_in_components,
    usable_edge_mask,
)


class RoutingPolicy(StrEnum):
    """Стратегии маршрутизации `03_GLOSSARY.md` §3.2."""

    BFS_SHORTEST = "bfs_shortest"
    PERSISTENT = "persistent"
    DIJKSTRA_DISTANCE = "dijkstra_distance"


class InternalInconsistencyError(RuntimeError):
    """Поиск пути и независимая проверка Union-Find разошлись.

    Это не разрыв связи и не ошибка данных, а ошибка расчёта: Run помечается `failed`
    (`04_CORE.md` §3.4), потому что дальше нельзя доверять ни одной метрике.
    """

    code: Final[str] = "INTERNAL_INCONSISTENCY"

    def __init__(self, message: str, *, tick: int, client: str) -> None:
        super().__init__(f"отсчёт {tick}, клиент {client}: {message}")
        self.tick = tick
        self.client = client


# Путь во внутреннем представлении: индексы узлов и индексы рёбер между ними.
_Route = tuple[list[int], list[int]]


@dataclass(frozen=True, slots=True, eq=False)
class RouteTable:
    """Маршруты всех клиентов на всей сетке времени для одной политики.

    Списки индексируются номером отсчёта, `None` означает отсутствие пути. Равенство по
    значению не нужно, а numpy-массив в сгенерированном `__eq__` дал бы «ambiguous truth
    value», поэтому eq выключен.
    """

    policy: RoutingPolicy
    clients: tuple[str, ...]
    ticks: int
    paths: dict[str, list[list[str] | None]]
    hops: dict[str, list[int | None]]
    length_km: dict[str, list[float | None]]
    route_switches: dict[str, int]

    def reachable(self, client: str) -> NDArray[np.bool_]:
        """Отсчёты клиента, на которых путь существует: основа `availability`."""
        return np.array([path is not None for path in self.paths[client]], dtype=np.bool_)


def _restore(came_from: dict[int, tuple[int, int]], end: int) -> _Route:
    """Разворачивает путь от найденного шлюза к клиенту по ссылкам на предшественника."""
    nodes = [end]
    edges: list[int] = []
    node = end
    while True:
        parent, edge = came_from[node]
        if parent < 0:
            break
        edges.append(edge)
        nodes.append(parent)
        node = parent
    nodes.reverse()
    edges.reverse()
    return nodes, edges


def _bfs_shortest(
    adjacency: Adjacency, source: int, satellite_count: int, is_end: list[bool]
) -> _Route | None:
    """Обход в ширину от клиента до первого достигнутого доступного шлюза.

    Транзит разрешён только аппаратам (индекс меньше `satellite_count`), поэтому чужие
    клиентские пункты помечаются посещёнными, но в очередь не попадают.
    """
    offsets = adjacency.offsets
    targets = adjacency.targets
    edge_ids = adjacency.edge_ids
    came_from: dict[int, tuple[int, int]] = {source: (-1, -1)}
    queue = deque((source,))
    while queue:
        node = queue.popleft()
        for position in range(offsets[node], offsets[node + 1]):
            other = targets[position]
            if other in came_from:
                continue
            came_from[other] = (node, edge_ids[position])
            if is_end[other]:
                return _restore(came_from, other)
            if other < satellite_count:
                queue.append(other)
    return None


def _dijkstra_distance(
    adjacency: Adjacency,
    source: int,
    satellite_count: int,
    is_end: list[bool],
    edge_length_km: list[float],
) -> _Route | None:
    """Кратчайший по сумме длин линий путь до доступного шлюза.

    Вес ребра — геометрическая длина линии в километрах: это прокси задержки
    распространения, по которому стратегии сравниваются между собой (ADR-003).
    """
    offsets = adjacency.offsets
    targets = adjacency.targets
    edge_ids = adjacency.edge_ids
    best: dict[int, float] = {source: 0.0}
    came_from: dict[int, tuple[int, int]] = {source: (-1, -1)}
    settled: set[int] = set()
    # Второй элемент ключа кучи — индекс узла: при равных расстояниях порядок извлечения
    # фиксирован, иначе повторный запуск мог бы вернуть другой из равноценных путей.
    heap: list[tuple[float, int]] = [(0.0, source)]
    while heap:
        distance, node = heappop(heap)
        if node in settled:
            continue
        settled.add(node)
        if is_end[node]:
            return _restore(came_from, node)
        for position in range(offsets[node], offsets[node + 1]):
            other = targets[position]
            if other in settled or not (other < satellite_count or is_end[other]):
                continue
            edge = edge_ids[position]
            candidate = distance + edge_length_km[edge]
            if candidate < best.get(other, inf):
                best[other] = candidate
                came_from[other] = (node, edge)
                heappush(heap, (candidate, other))
    return None


def _still_valid(route: _Route, is_end: list[bool], edge_present: list[bool]) -> bool:
    """Удерживаемый маршрут пригоден, если все его линии существуют и шлюз доступен.

    Отказ аппарата отдельно не проверяется: контакт-план уже снял его рёбра на затронутых
    отсчётах, и первая же проверка линии обнаружит разрыв.
    """
    nodes, edges = route
    if not is_end[nodes[-1]]:
        return False
    return all(edge_present[edge] for edge in edges)


def route_all(plan: ContactPlan, policy: RoutingPolicy) -> RouteTable:
    """Маршруты всех клиентов на всех отсчётах по выбранной политике.

    На каждом отсчёте список смежности и метки компонент строятся один раз и используются
    всеми клиентами. Результат каждого поиска сверяется с независимой проверкой Union-Find:
    расхождение означает ошибку расчёта и прекращает работу (`04_CORE.md` §3.4).
    """
    clients = plan.client_ids
    node_names = plan.nodes
    satellite_count = plan.satellite_count
    client_nodes = {client: plan.node_index[client] for client in clients}

    paths: dict[str, list[list[str] | None]] = {client: [] for client in clients}
    hops: dict[str, list[int | None]] = {client: [] for client in clients}
    length_km: dict[str, list[float | None]] = {client: [] for client in clients}
    route_switches = dict.fromkeys(clients, 0)
    held: dict[str, _Route | None] = dict.fromkeys(clients, None)
    previous: dict[str, list[str] | None] = dict.fromkeys(clients, None)

    for tick in range(plan.ticks):
        adjacency = build_adjacency(plan, tick)
        labels = components(plan, tick)
        is_end = [False] * len(node_names)
        for gateway_node in available_gateway_nodes(plan, tick):
            is_end[gateway_node] = True
        edge_present: list[bool] = usable_edge_mask(plan, tick).tolist()
        edge_length_km: list[float] = plan.dist[tick].tolist()

        for client in clients:
            source = client_nodes[client]
            route: _Route | None
            if policy is RoutingPolicy.DIJKSTRA_DISTANCE:
                route = _dijkstra_distance(
                    adjacency, source, satellite_count, is_end, edge_length_km
                )
            elif policy is RoutingPolicy.PERSISTENT and (current := held[client]) is not None:
                route = (
                    current
                    if _still_valid(current, is_end, edge_present)
                    else _bfs_shortest(adjacency, source, satellite_count, is_end)
                )
            else:
                route = _bfs_shortest(adjacency, source, satellite_count, is_end)

            expected = reachable_in_components(plan, tick, client, labels)
            if (route is not None) != expected:
                raise InternalInconsistencyError(
                    f"поиск пути дал {route is not None}, Union-Find дал {expected}",
                    tick=tick,
                    client=client,
                )

            held[client] = route
            if route is None:
                paths[client].append(None)
                hops[client].append(None)
                length_km[client].append(None)
                previous[client] = None
                continue

            nodes, edges = route
            path = [node_names[node] for node in nodes]
            paths[client].append(path)
            hops[client].append(len(edges))
            length_km[client].append(sum(edge_length_km[edge] for edge in edges))
            # Смена считается только между соседними отсчётами, на обоих из которых путь
            # есть: восстановление связи после перерыва — не перестроение маршрута.
            if previous[client] is not None and previous[client] != path:
                route_switches[client] += 1
            previous[client] = path

    return RouteTable(
        policy=policy,
        clients=clients,
        ticks=plan.ticks,
        paths=paths,
        hops=hops,
        length_km=length_km,
        route_switches=route_switches,
    )


class _FlowNetwork:
    """Сеть для Edmonds–Karp: рёбра парами «прямое, обратное», остаточная ёмкость на месте.

    Поток по прямому ребру равен остаточной ёмкости его обратной пары, поэтому отдельный
    массив потоков не нужен, а разложение потока на пути читает те же данные.
    """

    __slots__ = ("_capacity", "_incident", "_targets")

    def __init__(self, node_count: int) -> None:
        self._targets: list[int] = []
        self._capacity: list[int] = []
        self._incident: list[list[int]] = [[] for _ in range(node_count)]

    def add(self, source: int, target: int, capacity: int) -> None:
        self._incident[source].append(len(self._targets))
        self._targets.append(target)
        self._capacity.append(capacity)
        self._incident[target].append(len(self._targets))
        self._targets.append(source)
        self._capacity.append(0)

    def _augmenting_path(self, source: int, sink: int) -> list[int] | None:
        came_from: dict[int, int] = {}
        visited = {source}
        queue = deque((source,))
        while queue:
            node = queue.popleft()
            for edge in self._incident[node]:
                target = self._targets[edge]
                if self._capacity[edge] <= 0 or target in visited:
                    continue
                visited.add(target)
                came_from[target] = edge
                if target == sink:
                    path: list[int] = []
                    back = sink
                    while back != source:
                        step = came_from[back]
                        path.append(step)
                        # Обратная пара прямого ребра хранит его начало.
                        back = self._targets[step ^ 1]
                    path.reverse()
                    return path
                queue.append(target)
        return None

    def max_flow(self, source: int, sink: int) -> int:
        flow = 0
        while (path := self._augmenting_path(source, sink)) is not None:
            bottleneck = min(self._capacity[edge] for edge in path)
            for edge in path:
                self._capacity[edge] -= bottleneck
                self._capacity[edge ^ 1] += bottleneck
            flow += bottleneck
        return flow

    def residual_reachable(self, source: int) -> set[int]:
        """Узлы, достижимые из истока по рёбрам с остаточной ёмкостью: сторона разреза."""
        visited = {source}
        queue = deque((source,))
        while queue:
            node = queue.popleft()
            for edge in self._incident[node]:
                target = self._targets[edge]
                if self._capacity[edge] > 0 and target not in visited:
                    visited.add(target)
                    queue.append(target)
        return visited

    def take_flow_step(self, node: int) -> int | None:
        """Следующий узел по ребру с ненулевым потоком; поток по нему уменьшается на единицу.

        Прямые рёбра имеют чётные индексы, поэтому разложение не пойдёт назад по обратной
        паре и не зациклится.
        """
        for edge in self._incident[node]:
            if edge % 2 == 0 and self._capacity[edge ^ 1] > 0:
                self._capacity[edge ^ 1] -= 1
                return self._targets[edge]
        return None


def disjoint_paths(
    plan: ContactPlan, tick: int, client: str
) -> tuple[int, list[list[str]], tuple[str, ...]]:
    """Вершинно-непересекающиеся маршруты клиента и минимальный разрез (ADR-007).

    Каждый аппарат расщепляется на вход и выход ребром пропускной способности 1, остальные
    рёбра неограниченны. Поэтому величина потока равна числу маршрутов, не делящих ни
    одного аппарата, а минимальный разрез состоит только из аппаратов и отвечает на вопрос
    «без каких спутников связи нет», а не «без каких линий».
    """
    satellite_count = plan.satellite_count
    gateway_offset = 2 * satellite_count
    source_node = gateway_offset + len(plan.gateway_ids)
    sink_node = source_node + 1
    # Ёмкость, которую не может исчерпать ни один допустимый поток: каждый маршрут занимает
    # хотя бы один аппарат, значит маршрутов не больше, чем аппаратов.
    unlimited = satellite_count + 1

    network = _FlowNetwork(sink_node + 1)
    for satellite in range(satellite_count):
        network.add(satellite, satellite_count + satellite, 1)

    client_node = plan.node_index[client]
    # Узел графа доступного шлюза → его столбец в `gateway_available`: нумерация сети
    # потока держится столбцов, иначе при отказе одного шлюза маршрут приписался бы другому.
    gateway_column = {
        plan.node_index[gateway_id]: column
        for column, gateway_id in enumerate(plan.gateway_ids)
        if bool(plan.gateway_available[tick, column])
    }
    # Ребро контакт-плана записано как (аппарат, аппарат) или (аппарат, пункт): второй
    # конец и определяет, чем ребро становится в сети потока.
    for first, second in plan.edges[np.flatnonzero(usable_edge_mask(plan, tick))].tolist():
        if second < satellite_count:
            network.add(satellite_count + first, second, unlimited)
            network.add(satellite_count + second, first, unlimited)
        elif second == client_node:
            network.add(source_node, first, unlimited)
        elif second in gateway_column:
            network.add(satellite_count + first, gateway_offset + gateway_column[second], unlimited)

    for column in gateway_column.values():
        network.add(gateway_offset + column, sink_node, unlimited)

    count = network.max_flow(source_node, sink_node)
    reachable = network.residual_reachable(source_node)
    min_cut = tuple(
        plan.nodes[satellite]
        for satellite in range(satellite_count)
        if satellite in reachable and satellite_count + satellite not in reachable
    )

    gateway_id_of = {
        gateway_offset + column: plan.gateway_ids[column] for column in gateway_column.values()
    }
    paths: list[list[str]] = []
    for _ in range(count):
        path = [client]
        node = source_node
        while node != sink_node:
            step = network.take_flow_step(node)
            if step is None:
                raise InternalInconsistencyError(
                    f"поток величиной {count} не раскладывается на пути", tick=tick, client=client
                )
            node = step
            if node < satellite_count:
                path.append(plan.nodes[node])
            elif node in gateway_id_of:
                path.append(gateway_id_of[node])
        paths.append(path)
    return count, paths, min_cut
