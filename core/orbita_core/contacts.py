"""Contact plan: какие линии связи существуют и на каких отсчётах.

Трасса горизонта хранится не как снимок на каждый отсчёт, а как список возможных рёбер
и битовая матрица «отсчёты × рёбра» (ADR-002, ADR-010): для группировки из нескольких
десятков аппаратов это единицы сотен килобайт вместо сотен мегабайт JSON.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

from orbita_core import geometry
from orbita_core.scenario import Scenario, Unavailability


class EdgeKind(StrEnum):
    """Тип линии связи: межспутниковая или наземная (пункт — аппарат)."""

    ISL = "isl"
    GROUND = "ground"


# Равенство рёбер и матриц по значению смысла не имеет, а numpy-массивы в
# сгенерированном `__eq__` вызвали бы «ambiguous truth value», поэтому eq выключен.
@dataclass(frozen=True, slots=True, eq=False)
class ContactPlan:
    """Узлы, возможные рёбра и их состояние на каждом отсчёте.

    Ребро попадает в план, если оно существует хотя бы на одном отсчёте: линия, которая
    не возникает никогда, не нужна ни маршрутизации, ни визуализации.
    """

    nodes: tuple[str, ...]
    node_index: dict[str, int]
    satellite_count: int
    step_s: int
    edges: NDArray[np.int64]
    kinds: tuple[EdgeKind, ...]
    bits: NDArray[np.bool_]
    dist: NDArray[np.float64]
    active: NDArray[np.bool_]
    gateway_ids: tuple[str, ...]
    gateway_available: NDArray[np.bool_]
    positions: NDArray[np.float64]

    @property
    def ticks(self) -> int:
        return int(self.bits.shape[0])

    @property
    def edge_count(self) -> int:
        return int(self.edges.shape[0])

    @property
    def satellite_ids(self) -> tuple[str, ...]:
        return self.nodes[: self.satellite_count]

    @property
    def client_ids(self) -> tuple[str, ...]:
        """Наземные пункты, не являющиеся шлюзами: для них и считается маршрут.

        Роль пункта — `client` или `gateway` (`03_GLOSSARY.md` §3.5), поэтому список
        клиентов однозначно восстанавливается из узлов и `gateway_ids`.
        """
        gateways = frozenset(self.gateway_ids)
        return tuple(node for node in self.nodes[self.satellite_count :] if node not in gateways)

    def edges_at(self, tick: int) -> NDArray[np.int64]:
        """Индексы рёбер, существующих на отсчёте `tick`."""
        return np.flatnonzero(self.bits[tick]).astype(np.int64)

    def visible_satellites(self, tick: int, site_id: str) -> tuple[str, ...]:
        """Активные аппараты, видимые наземному пункту на отсчёте."""
        site_node = self.node_index[site_id]
        # Наземное ребро всегда записано как (аппарат, пункт): индекс аппарата меньше.
        mask = self.bits[tick] & (self.edges[:, 1] == site_node)
        return tuple(self.nodes[index] for index in self.edges[mask, 0])

    def client_visible(self, tick: int, client_id: str) -> tuple[str, ...]:
        """Аппараты, видимые клиентскому пункту: вход в сеть на этом отсчёте."""
        return self.visible_satellites(tick, client_id)

    def is_gateway_available(self, tick: int, gateway_id: str) -> bool:
        """Шлюз вне периода недоступности (`01_SPEC.md` §2.4)."""
        return bool(self.gateway_available[tick, self.gateway_ids.index(gateway_id)])


def _unavailable_mask(
    times_s: NDArray[np.float64],
    intervals: tuple[Unavailability, ...],
    column_of: dict[str, int],
    columns: int,
) -> NDArray[np.bool_]:
    """Матрица `(ticks, columns)`: True там, где узел недоступен.

    Интервал `[start_s; end_s)`: начало включительно, конец исключительно, поэтому
    аппарат исключён на отсчёте `start_s` и уже работает на отсчёте `end_s`.
    """
    unavailable = np.zeros((times_s.size, columns), dtype=np.bool_)
    for interval in intervals:
        covered = (times_s >= interval.start_s) & (times_s < interval.end_s)
        unavailable[:, column_of[interval.node_id]] |= covered
    return unavailable


def _active_satellites(scenario: Scenario) -> NDArray[np.bool_]:
    """Матрица активности аппаратов `(ticks, N)`: очередь запуска минус отказы."""
    launched = np.array(
        [satellite.launch_batch <= scenario.launch_stage for satellite in scenario.satellites],
        dtype=np.bool_,
    )
    failed = _unavailable_mask(
        scenario.times_s, scenario.failures, scenario.satellite_index, len(scenario.satellites)
    )
    return launched[None, :] & ~failed


def _gateway_available(scenario: Scenario) -> NDArray[np.bool_]:
    """Доступность шлюзов `(ticks, G_gw)` в порядке `scenario.gateway_ids`."""
    gateway_ids = scenario.gateway_ids
    column_of = {gateway_id: column for column, gateway_id in enumerate(gateway_ids)}
    return ~_unavailable_mask(
        scenario.times_s, scenario.gateway_outages, column_of, len(gateway_ids)
    )


def build(scenario: Scenario) -> ContactPlan:
    """Строит contact plan сценария на всей сетке времени.

    Неактивный аппарат и недоступный шлюз исключаются из своих рёбер на затронутых
    отсчётах, но позиции аппарата сохраняются: на схеме он виден как неработающий
    (инвариант 14 `10_FIXTURES.md`).
    """
    environment = scenario.environment
    satellite_count = len(scenario.satellites)
    site_count = len(scenario.ground_sites)

    positions = geometry.positions_all(scenario)
    site_positions = geometry.ground_positions(scenario)
    active = _active_satellites(scenario)
    gateway_available = _gateway_available(scenario)

    isl_first, isl_second = geometry.isl_pair_indices(satellite_count)
    isl_visible, isl_distance = geometry.isl_visible_all(positions, environment.isl_range_km)
    isl_bits = isl_visible & active[:, isl_first] & active[:, isl_second]
    isl_edges = np.stack((isl_first, isl_second), axis=1)

    elevation_deg = geometry.elevation_all(positions, site_positions)
    ground_distance = geometry.slant_range_all(positions, site_positions)
    # Возвышение сравнивается через `>=`: контакт доступен при угле «не меньше»
    # минимального (`01_SPEC.md` §2.4), в отличие от строгого `<` для дальности ISL.
    site_available = np.ones((scenario.ticks, site_count), dtype=np.bool_)
    site_available[:, list(scenario.gateway_indices)] = gateway_available
    ground_visible = (
        (elevation_deg >= environment.min_elevation_deg)
        & active[:, None, :]
        & site_available[:, :, None]
    )
    ground_bits = ground_visible.reshape(scenario.ticks, site_count * satellite_count)
    ground_dist = ground_distance.reshape(scenario.ticks, site_count * satellite_count)
    ground_edges = np.stack(
        (
            np.tile(np.arange(satellite_count, dtype=np.int64), site_count),
            np.repeat(
                np.arange(satellite_count, satellite_count + site_count, dtype=np.int64),
                satellite_count,
            ),
        ),
        axis=1,
    )

    bits = np.concatenate((isl_bits, ground_bits), axis=1)
    dist = np.concatenate((isl_distance, ground_dist), axis=1)
    edges = np.concatenate((isl_edges, ground_edges), axis=0)
    kinds = (EdgeKind.ISL,) * isl_edges.shape[0] + (EdgeKind.GROUND,) * ground_edges.shape[0]

    # Узлы графа: сначала аппараты в порядке сценария, затем наземные пункты.
    nodes = tuple(satellite.id for satellite in scenario.satellites) + tuple(
        site.id for site in scenario.ground_sites
    )
    possible = np.flatnonzero(bits.any(axis=0))
    return ContactPlan(
        nodes=nodes,
        node_index={node: index for index, node in enumerate(nodes)},
        satellite_count=satellite_count,
        step_s=environment.step_s,
        edges=edges[possible],
        kinds=tuple(kinds[index] for index in possible),
        bits=np.ascontiguousarray(bits[:, possible]),
        dist=np.ascontiguousarray(dist[:, possible]),
        active=active,
        gateway_ids=scenario.gateway_ids,
        gateway_available=gateway_available,
        positions=positions,
    )
