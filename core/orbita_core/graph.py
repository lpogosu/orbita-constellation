"""Граф связи на одном отсчёте: смежность, компоненты и независимая проверка достижимости.

Граф `G_t` не хранится снимком, а разворачивается из битовой строки contact plan
(ADR-002, ADR-010): рёбра отсчёта берутся готовыми индексами, поэтому стоимость построения
зависит от числа существующих линий, а не от числа пар узлов.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from orbita_core.contacts import ContactPlan


@dataclass(frozen=True, slots=True)
class Adjacency:
    """Список смежности графа одного отсчёта в CSR-форме.

    Три плоских списка вместо словаря списков: соседи каждого узла лежат непрерывным
    срезом, поиск пути читает их без создания промежуточных объектов на каждый узел.
    `edge_ids` хранит индекс ребра в contact plan, чтобы по нему брать длину линии и
    проверять существование удерживаемого маршрута.
    """

    node_count: int
    offsets: list[int]
    targets: list[int]
    edge_ids: list[int]

    def neighbors(self, node: int) -> list[tuple[int, int]]:
        """Пары «сосед, индекс ребра» в порядке возрастания индекса соседа."""
        start = self.offsets[node]
        stop = self.offsets[node + 1]
        return list(zip(self.targets[start:stop], self.edge_ids[start:stop], strict=True))


def usable_edge_mask(plan: ContactPlan, tick: int) -> NDArray[np.bool_]:
    """Рёбра графа `G_t`: существующие линии, кроме ведущих к недоступному шлюзу.

    Узлами `G_t` являются только доступные шлюзы (ADR-002), поэтому линия к шлюзу в
    периоде недоступности не просто не завершает маршрут — её нет в графе вовсе. Иначе два
    аппарата, видящие один отказавший шлюз, оказались бы связаны через него, и независимая
    проверка Union-Find подтверждала бы несуществующую достижимость.
    """
    present: NDArray[np.bool_] = plan.bits[tick]
    blocked = np.flatnonzero(~plan.gateway_available[tick])
    if blocked.size == 0:
        return present
    blocked_nodes = np.array(
        [plan.node_index[plan.gateway_ids[int(column)]] for column in blocked], dtype=np.int64
    )
    # Наземное ребро записано как (аппарат, пункт), поэтому шлюз ищется во втором столбце.
    return np.asarray(present & ~np.isin(plan.edges[:, 1], blocked_nodes), dtype=np.bool_)


def build_adjacency(plan: ContactPlan, tick: int) -> Adjacency:
    """Список смежности неориентированного графа отсчёта.

    Порядок соседей задан возрастанием их индекса. Без фиксированного порядка обход в
    ширину выбирал бы разный путь из нескольких равных по длине, и повторный запуск той же
    конфигурации давал бы другой экспорт вопреки ADR-011.
    """
    return _adjacency_of(plan, usable_edge_mask(plan, tick))


def _adjacency_of(plan: ContactPlan, mask: NDArray[np.bool_]) -> Adjacency:
    """Список смежности по произвольному набору рёбер плана.

    Отдельно от `build_adjacency`, потому что анализ устойчивости работает на том же
    графе без клиентских рёбер: топология сети от того, кто к ней подключён, не зависит.
    """
    present = np.flatnonzero(mask).astype(np.int64)
    first = plan.edges[present, 0]
    second = plan.edges[present, 1]
    source = np.concatenate((first, second))
    target = np.concatenate((second, first))
    edge = np.concatenate((present, present))
    order = np.lexsort((target, source))
    node_count = len(plan.nodes)
    offsets = np.zeros(node_count + 1, dtype=np.int64)
    offsets[1:] = np.cumsum(np.bincount(source, minlength=node_count))
    offset_list: list[int] = offsets.tolist()
    target_list: list[int] = target[order].tolist()
    edge_list: list[int] = edge[order].tolist()
    return Adjacency(
        node_count=node_count, offsets=offset_list, targets=target_list, edge_ids=edge_list
    )


def available_gateway_nodes(plan: ContactPlan, tick: int) -> tuple[int, ...]:
    """Узлы шлюзов вне периода недоступности: только они завершают маршрут.

    Проверка идёт по `gateway_available`, а не по наличию рёбер: недоступный шлюз не может
    быть концом пути, даже если геометрически видит аппараты (`01_SPEC.md` §2.4).
    """
    columns = np.flatnonzero(plan.gateway_available[tick])
    return tuple(plan.node_index[plan.gateway_ids[int(column)]] for column in columns)


class UnionFind:
    """Система непересекающихся множеств: объединение по размеру, сжатие пути."""

    __slots__ = ("_parent", "_size")

    def __init__(self, node_count: int) -> None:
        self._parent: list[int] = list(range(node_count))
        self._size: list[int] = [1] * node_count

    def find(self, node: int) -> int:
        parent = self._parent
        root = node
        while parent[root] != root:
            parent[root] = parent[parent[root]]
            root = parent[root]
        return root

    def union(self, first: int, second: int) -> None:
        left = self.find(first)
        right = self.find(second)
        if left == right:
            return
        if self._size[left] < self._size[right]:
            left, right = right, left
        self._parent[right] = left
        self._size[left] += self._size[right]

    def labels(self) -> list[int]:
        """Корень своего множества для каждого узла."""
        return [self.find(node) for node in range(len(self._parent))]


def _transit_edge_mask(plan: ContactPlan) -> NDArray[np.bool_]:
    """Рёбра, по которым разрешён транзит: оба конца не клиентские пункты."""
    client_nodes = np.array(
        [plan.node_index[client_id] for client_id in plan.client_ids], dtype=np.int64
    )
    touches_client = np.isin(plan.edges, client_nodes)
    return np.asarray(~(touches_client[:, 0] | touches_client[:, 1]), dtype=np.bool_)


def components(plan: ContactPlan, tick: int) -> list[int]:
    """Метка компоненты связности для каждого узла графа отсчёта.

    Клиентский пункт не ретранслирует, поэтому его рёбра в объединение не входят и каждый
    клиент остаётся отдельной компонентой. Иначе два клиента, видящие один аппарат,
    оказались бы связаны через него, и проверка достижимости потеряла бы смысл (ADR-002).
    """
    present = np.flatnonzero(usable_edge_mask(plan, tick) & _transit_edge_mask(plan))
    union_find = UnionFind(len(plan.nodes))
    for first, second in plan.edges[present].tolist():
        union_find.union(first, second)
    return union_find.labels()


def component_ids(plan: ContactPlan, tick: int) -> tuple[int, ...]:
    """Метки компонент только для аппаратов: вход диагностики `NETWORK_PARTITION`."""
    return tuple(components(plan, tick)[: plan.satellite_count])


def reachable_in_components(plan: ContactPlan, tick: int, client: str, labels: list[int]) -> bool:
    """Достижимость на готовых метках компонент.

    Отдельная от `reachable_unionfind` функция нужна маршрутизации: метки на отсчёте
    считаются один раз и переиспользуются всеми клиентами.
    """
    gateway_roots = {labels[node] for node in available_gateway_nodes(plan, tick)}
    if not gateway_roots:
        return False
    return any(
        labels[plan.node_index[satellite_id]] in gateway_roots
        for satellite_id in plan.client_visible(tick, client)
    )


def reachable_unionfind(plan: ContactPlan, tick: int, client: str) -> bool:
    """Проверка достижимости шлюза без поиска пути (`04_CORE.md` §3.4).

    Клиент достижим, если у него есть видимый аппарат в компоненте какого-либо доступного
    шлюза. Расхождение с обходом в ширину означает ошибку расчёта, а не разрыв связи.
    """
    return reachable_in_components(plan, tick, client, components(plan, tick))


def transit_adjacency(plan: ContactPlan, tick: int) -> Adjacency:
    """Граф отсчёта без клиентских рёбер: то, из чего состоит сама сеть.

    Клиентский пункт не ретранслирует (ADR-002), поэтому его линия не может быть мостом
    сети: её пропажа отключает одного потребителя, а не разрывает связность аппаратов.
    Анализ устойчивости смотрит на сеть, и клиентские рёбра в нём только создавали бы
    мосты на каждом подключении.
    """
    return _adjacency_of(plan, usable_edge_mask(plan, tick) & _transit_edge_mask(plan))


@dataclass(frozen=True, slots=True)
class _Decomposition:
    """Результат одного обхода Тарьяна: мосты, точки сочленения, двусвязные компоненты.

    Все три величины получаются из одних и тех же времён входа и минимальных достижимых
    времён, поэтому обход один, а публичные функции берут из него нужную часть.
    """

    bridges: tuple[tuple[int, int], ...]
    articulation_points: frozenset[int]
    components: tuple[frozenset[int], ...]


def _decompose(adjacency: Adjacency) -> _Decomposition:
    """Обход Тарьяна на списке смежности, без рекурсии.

    Стек обхода явный: глубина равна числу узлов графа, и на группировке в несколько
    сотен аппаратов рекурсия упёрлась бы в предел интерпретатора там, где сеть вытянута
    в цепочку — то есть ровно в самом интересном для анализа случае.

    Ребро, по которому пришли, узнаётся по индексу ребра, а не по номеру узла: так
    обход остаётся верным и для пары узлов, соединённых двумя линиями.
    """
    node_count = adjacency.node_count
    offsets = adjacency.offsets
    targets = adjacency.targets
    edge_ids = adjacency.edge_ids

    entered = [-1] * node_count
    lowest = [0] * node_count
    time = 0
    bridges: list[tuple[int, int]] = []
    articulation: set[int] = set()
    components: list[frozenset[int]] = []
    # Рёбра в порядке обхода: по ним двусвязная компонента снимается целиком, как только
    # найден её верхний узел.
    edge_stack: list[tuple[int, int]] = []

    for root in range(node_count):
        if entered[root] != -1:
            continue
        entered[root] = lowest[root] = time
        time += 1
        root_children = 0
        # Кадр обхода: узел, ребро к родителю и позиция следующего непросмотренного соседа.
        stack: list[tuple[int, int, int]] = [(root, -1, offsets[root])]
        while stack:
            node, parent_edge, cursor = stack[-1]
            if cursor < offsets[node + 1]:
                stack[-1] = (node, parent_edge, cursor + 1)
                other = targets[cursor]
                edge = edge_ids[cursor]
                if edge == parent_edge:
                    continue
                if entered[other] != -1:
                    # Обратное ребро учитывается один раз — из более позднего узла в более
                    # ранний; второй его конец увидит то же ребро «вниз» и пропустит.
                    if entered[other] < entered[node]:
                        edge_stack.append((node, other))
                        lowest[node] = min(lowest[node], entered[other])
                    continue
                edge_stack.append((node, other))
                entered[other] = lowest[other] = time
                time += 1
                if node == root:
                    root_children += 1
                stack.append((other, edge, offsets[other]))
                continue

            stack.pop()
            if not stack:
                continue
            parent = stack[-1][0]
            lowest[parent] = min(lowest[parent], lowest[node])
            if lowest[node] >= entered[parent]:
                components.append(_pop_component(edge_stack, parent, node))
                # Корень разделяет граф только если из него растёт больше одного поддерева:
                # с единственным потомком его удаление оставляет остальное связным.
                if parent != root or root_children > 1:
                    articulation.add(parent)
            if lowest[node] > entered[parent]:
                bridges.append((parent, node))

    return _Decomposition(
        bridges=tuple(bridges),
        articulation_points=frozenset(articulation),
        components=tuple(components),
    )


def _pop_component(edge_stack: list[tuple[int, int]], parent: int, node: int) -> frozenset[int]:
    """Снимает со стека рёбра двусвязной компоненты вплоть до ребра `(parent, node)`."""
    nodes: set[int] = set()
    while True:
        first, second = edge_stack.pop()
        nodes.add(first)
        nodes.add(second)
        if (first, second) == (parent, node):
            return frozenset(nodes)


def bridges(plan: ContactPlan, tick: int) -> list[tuple[str, str]]:
    """Линии сети, при потере которых граф отсчёта распадается (`04_CORE.md` §3.5).

    Концы каждого ребра и сам список упорядочены по индексу узла: результат уходит в
    объяснение разрыва, и одинаковый вход обязан давать одинаковый текст (ADR-011).
    """
    decomposition = _decompose(transit_adjacency(plan, tick))
    ordered = sorted(
        (first, second) if first < second else (second, first)
        for first, second in decomposition.bridges
    )
    return [(plan.nodes[first], plan.nodes[second]) for first, second in ordered]


def articulation_points(plan: ContactPlan, tick: int) -> set[str]:
    """Узлы, удаление которых разрывает сеть на этом отсчёте.

    Считается на графе без клиентских рёбер, поэтому в ответ попадают аппараты и шлюзы:
    именно их отказ разносит сеть на части.
    """
    decomposition = _decompose(transit_adjacency(plan, tick))
    return {plan.nodes[node] for node in decomposition.articulation_points}


def biconnected_components(plan: ContactPlan, tick: int) -> list[set[str]]:
    """Двусвязные компоненты графа отсчёта: участки сети без единой точки отказа.

    Изолированный узел ни в одну компоненту не входит: компонента задаётся рёбрами, а не
    вершинами, и аппарат без единой линии связи участком сети не является.
    """
    decomposition = _decompose(transit_adjacency(plan, tick))
    ordered = sorted(sorted(component) for component in decomposition.components)
    return [{plan.nodes[node] for node in component} for component in ordered]
