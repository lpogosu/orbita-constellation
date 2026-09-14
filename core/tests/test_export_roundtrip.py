"""Инварианты выгрузки `cosmo-A-result-1.0` и её повторной загрузки.

Проверки идут по содержимому экспортированного файла, а не по внутренним структурам
ядра: инварианты 1, 2, 9, 10 и 11 `10_FIXTURES.md` §2 говорят именно о выгрузке, и
ошибка сериализации не должна прятаться за корректным `RouteTable`.
"""

from __future__ import annotations

from functools import cache
from itertools import pairwise
from pathlib import Path
from typing import Any, Final

import numpy as np
import pytest

from orbita_core import contacts, engine
from orbita_core.contacts import ContactPlan
from orbita_core.export import (
    EXPORT_SCHEMA_VERSION,
    ExportError,
    build_export,
    dumps_export,
    load_export,
    loads_export,
)
from orbita_core.geometry import EARTH_RADIUS_KM
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import Scenario, load, parse, validate
from tests.support import SCENARIO_PATHS, SCENARIOS_DIR, synthetic_scenario

# Отказ, попадающий внутрь горизонта синтетического сценария: границы кратны шагу сетки,
# чтобы отсчёты `a` и `b` существовали и инвариант 12 проверялся буквально.
FAILURE_START_S: Final[int] = 1200
FAILURE_END_S: Final[int] = 3600


@cache
def _export(scenario_path: Path) -> dict[str, Any]:
    """Выгрузка сценария по `bfs_shortest`; резервные пути для инвариантов не нужны."""
    result = engine.run(load(scenario_path), RoutingPolicy.BFS_SHORTEST, backup_paths=False)
    return build_export(result)


@cache
def _plan(scenario_path: Path) -> ContactPlan:
    return contacts.build(load(scenario_path))


def _edge_lookup(plan: ContactPlan) -> dict[tuple[int, int], int]:
    """Номер ребра по паре узлов: проверять существование линии перебором дорого."""
    return {
        (min(first, second), max(first, second)): index
        for index, (first, second) in enumerate(plan.edges.tolist())
    }


def _routes(export: dict[str, Any]) -> list[dict[str, Any]]:
    routes: list[dict[str, Any]] = export["routes"]
    return routes


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_every_path_edge_exists_on_its_tick(scenario_path: Path) -> None:
    """Инвариант 1: каждое ребро выгруженного маршрута существует в `G_t` своего отсчёта."""
    plan = _plan(scenario_path)
    lookup = _edge_lookup(plan)
    checked = 0
    for record in _routes(_export(scenario_path)):
        tick = record["t_s"] // plan.step_s
        nodes = [plan.node_index[node_id] for node_id in record["path"]]
        for first, second in pairwise(nodes):
            key = (min(first, second), max(first, second))
            assert key in lookup, f"линии {record['path']} нет в contact plan"
            assert plan.bits[tick, lookup[key]], f"линия отсутствует на отсчёте {record['t_s']}"
            checked += 1
    assert checked > 0


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_path_endpoints_and_transit_nodes(scenario_path: Path) -> None:
    """Инвариант 2: клиент в начале, доступный шлюз в конце, аппараты между ними."""
    plan = _plan(scenario_path)
    clients = frozenset(plan.client_ids)
    satellites = frozenset(plan.satellite_ids)
    for record in _routes(_export(scenario_path)):
        path: list[str] = record["path"]
        if not path:
            continue
        tick = record["t_s"] // plan.step_s
        assert path[0] == record["client_id"]
        assert path[-1] in plan.gateway_ids
        assert plan.is_gateway_available(tick, path[-1])
        for node_id in path[1:-1]:
            assert node_id in satellites
            assert node_id not in clients
            assert plan.active[tick, plan.node_index[node_id]]


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_route_records_cover_every_pair_once(scenario_path: Path) -> None:
    """Инвариант 9: записей ровно `total_ticks × число клиентов`, дубликатов нет."""
    scenario = load(scenario_path)
    routes = _routes(_export(scenario_path))
    assert len(routes) == scenario.ticks * len(scenario.client_ids)
    pairs = {(record["t_s"], record["client_id"]) for record in routes}
    assert len(pairs) == len(routes)
    assert pairs == {
        (tick * scenario.environment.step_s, client_id)
        for tick in range(scenario.ticks)
        for client_id in scenario.client_ids
    }


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_grid_includes_zero_and_excludes_horizon(scenario_path: Path) -> None:
    """Инвариант 11: отсчёт `t = 0` рассчитан, отсчёт `t = horizon_s` — нет."""
    scenario = load(scenario_path)
    times = {record["t_s"] for record in _routes(_export(scenario_path))}
    assert min(times) == 0
    assert max(times) == scenario.environment.horizon_s - scenario.environment.step_s
    assert scenario.environment.horizon_s not in times


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_effective_scenario_passes_validation(scenario_path: Path) -> None:
    """Инвариант 10, первая половина: выгруженный сценарий валиден без правок."""
    assert validate(_export(scenario_path)["effective_scenario"]) == []


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_repeated_run_gives_identical_file(scenario_path: Path) -> None:
    """Инвариант 10, вторая половина: повторный расчёт даёт байт в байт тот же файл."""
    scenario = load(scenario_path)
    first = dumps_export(build_export(engine.run(scenario, RoutingPolicy.BFS_SHORTEST)))
    second = dumps_export(build_export(engine.run(scenario, RoutingPolicy.BFS_SHORTEST)))
    assert first.encode("utf-8") == second.encode("utf-8")


def test_export_reloads_into_a_new_run(tmp_path: Path) -> None:
    """Выгрузка приёмочного сценария читается обратно и даёт тот же `config_hash`.

    Сценарий с чужими идентификаторами (ADR-015) берётся намеренно: замыкание «расчёт →
    файл → расчёт» не должно зависеть от имён из кейса.
    """
    scenario_path = SCENARIOS_DIR / "hidden_like.json"
    first = engine.run(load(scenario_path), RoutingPolicy.BFS_SHORTEST)
    export_path = tmp_path / "result.json"
    export_path.write_text(dumps_export(build_export(first)), encoding="utf-8", newline="")

    loaded = load_export(export_path)
    assert loaded.schema_version == EXPORT_SCHEMA_VERSION
    assert loaded.config_hash == first.config_hash
    assert loaded.routing_policy is first.routing_policy

    second = engine.run(loaded.scenario, loaded.routing_policy)
    assert second.config_hash == first.config_hash
    assert dumps_export(build_export(second)) == dumps_export(build_export(first))


def test_load_export_rejects_a_foreign_schema() -> None:
    """Чужая схема бракуется с указанием поля, а не разбирается «как получится»."""
    scenario_path = SCENARIO_PATHS[0]
    text = dumps_export(build_export(engine.run(load(scenario_path), RoutingPolicy.BFS_SHORTEST)))
    with pytest.raises(ExportError) as error:
        loads_export(text.replace(EXPORT_SCHEMA_VERSION, "cosmo-A-result-0.9", 1))
    assert error.value.path == "schema_version"


def test_load_export_rejects_a_duplicated_pair() -> None:
    """Инвариант 9 проверяется и на входе: повтор пары «отсчёт — клиент» не проходит."""
    scenario_path = SCENARIO_PATHS[0]
    export = build_export(engine.run(load(scenario_path), RoutingPolicy.BFS_SHORTEST))
    routes = _routes(export)
    routes[1] = dict(routes[0])
    with pytest.raises(ExportError) as error:
        loads_export(dumps_export(export))
    assert error.value.path == "routes[1]"


def _failed_scenario(intervals: list[dict[str, object]]) -> Scenario:
    raw = synthetic_scenario(failures=intervals)
    return parse(raw)


def _failed_satellite_id() -> str:
    """Первый аппарат синтетического сценария: имена в нём генерируются, не из кейса."""
    satellites: list[dict[str, Any]] = synthetic_scenario()["design"]["satellites"]
    return str(satellites[0]["id"])


def test_failure_interval_is_closed_open() -> None:
    """Инвариант 12: при `t = a` аппарат исключён из рёбер, при `t = b` снова в графе."""
    satellite_id = _failed_satellite_id()
    scenario = _failed_scenario(
        [{"satellite_id": satellite_id, "start_s": FAILURE_START_S, "end_s": FAILURE_END_S}]
    )
    plan = contacts.build(scenario)
    node = plan.node_index[satellite_id]
    step_s = scenario.environment.step_s
    start_tick = FAILURE_START_S // step_s
    end_tick = FAILURE_END_S // step_s

    assert not plan.active[start_tick, node]
    assert not np.any(plan.bits[start_tick] & np.any(plan.edges == node, axis=1))
    assert plan.active[end_tick, node]
    assert plan.active[start_tick - 1, node]


def test_overlapping_failures_equal_their_union() -> None:
    """Инвариант 13: пересекающиеся отказы одного аппарата дают тот же расчёт."""
    satellite_id = _failed_satellite_id()
    middle_s = (FAILURE_START_S + FAILURE_END_S) // 2
    split = _failed_scenario(
        [
            {"satellite_id": satellite_id, "start_s": FAILURE_START_S, "end_s": middle_s + 600},
            {"satellite_id": satellite_id, "start_s": middle_s, "end_s": FAILURE_END_S},
        ]
    )
    union = _failed_scenario(
        [{"satellite_id": satellite_id, "start_s": FAILURE_START_S, "end_s": FAILURE_END_S}]
    )
    split_run = engine.run(split, RoutingPolicy.BFS_SHORTEST)
    union_run = engine.run(union, RoutingPolicy.BFS_SHORTEST)
    assert split_run.config_hash == union_run.config_hash
    assert dumps_export(build_export(split_run)) == dumps_export(build_export(union_run))


def test_unavailable_satellite_keeps_its_coordinates() -> None:
    """Инвариант 14: недоступный аппарат остаётся в позициях, но выключен из графа."""
    satellite_id = _failed_satellite_id()
    scenario = _failed_scenario(
        [{"satellite_id": satellite_id, "start_s": FAILURE_START_S, "end_s": FAILURE_END_S}]
    )
    plan = contacts.build(scenario)
    tick = FAILURE_START_S // scenario.environment.step_s
    position = plan.positions[tick, plan.node_index[satellite_id]]
    expected_radius_km = EARTH_RADIUS_KM + scenario.environment.altitude_km
    assert float(np.linalg.norm(position)) == pytest.approx(expected_radius_km, abs=1e-6)
    assert not plan.active[tick, plan.node_index[satellite_id]]


def test_launch_stage_activates_exactly_its_batches() -> None:
    """Инвариант 15: `launch_stage = 1` оставляет активными только первую очередь."""
    raw = synthetic_scenario(launch_batches=[1, 2, 1, 3, 2, 1, 3, 2], launch_stage=1)
    scenario = parse(raw)
    plan = contacts.build(scenario)
    first_batch = {
        str(item["id"]) for item in raw["design"]["satellites"] if item["launch_batch"] == 1
    }
    active_ids = {
        satellite_id
        for index, satellite_id in enumerate(plan.satellite_ids)
        if bool(np.any(plan.active[:, index]))
    }
    assert active_ids == first_batch
