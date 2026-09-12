"""Сверка ядра с официальным `case/geometry/geometry.py` на выборке отсчётов.

Эталон считает один отсчёт за вызов, ядро — все сразу. Тест доказывает, что
векторизация не изменила формулы: совпадают и координаты, и состав рёбер, и длины линий.
"""

from __future__ import annotations

from pathlib import Path
from types import ModuleType
from typing import Any, Final

import numpy as np
import pytest

from orbita_core import contacts, geometry
from orbita_core.scenario import load
from tests.support import CROSSCHECK_TIMES_S, SCENARIO_PATHS, load_reference_geometry, read_json

# Допуск из карточки M1-A: 1e-6 км, то есть один миллиметр на 7000 км орбиты.
TOLERANCE_KM: Final[float] = 1e-6


@pytest.fixture(scope="module")
def reference() -> ModuleType:
    return load_reference_geometry()


def _edge_set(node_pairs: list[tuple[str, str, float]]) -> dict[frozenset[str], float]:
    return {frozenset((first, second)): distance for first, second, distance in node_pairs}


def _reference_edges(
    reference: ModuleType, raw: dict[str, Any], t_s: int
) -> dict[frozenset[str], float]:
    snapshot = reference.snapshot(raw, float(t_s))
    return _edge_set([(edge[0], edge[1], float(edge[2])) for edge in snapshot["edges"]])


def _plan_edges(plan: contacts.ContactPlan, tick: int) -> dict[frozenset[str], float]:
    return _edge_set(
        [
            (
                plan.nodes[plan.edges[index, 0]],
                plan.nodes[plan.edges[index, 1]],
                float(plan.dist[tick, index]),
            )
            for index in plan.edges_at(tick)
        ]
    )


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_positions_match_reference(reference: ModuleType, scenario_path: Path) -> None:
    """Позиции в земной системе совпадают с эталонными на контрольных отсчётах."""
    raw = read_json(scenario_path)
    scenario = load(scenario_path)
    positions = geometry.positions_all(scenario)
    for t_s in CROSSCHECK_TIMES_S:
        reference_ids, _, reference_fixed = reference.positions(raw, float(t_s))
        expected = np.asarray(reference_fixed, dtype=np.float64)
        # Ядро сортирует аппараты по идентификатору, эталон сохраняет порядок файла.
        order = [scenario.satellite_index[satellite_id] for satellite_id in reference_ids]
        actual = positions[t_s // scenario.environment.step_s][order]
        assert np.max(np.abs(actual - expected)) < TOLERANCE_KM


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_edges_match_reference_snapshot(reference: ModuleType, scenario_path: Path) -> None:
    """Состав рёбер и их длины совпадают с эталонным снимком сети."""
    raw = read_json(scenario_path)
    scenario = load(scenario_path)
    plan = contacts.build(scenario)
    for t_s in CROSSCHECK_TIMES_S:
        expected = _reference_edges(reference, raw, t_s)
        actual = _plan_edges(plan, t_s // scenario.environment.step_s)
        assert set(actual) == set(expected)
        for edge, distance_km in expected.items():
            assert abs(actual[edge] - distance_km) < TOLERANCE_KM


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_active_satellites_match_reference(reference: ModuleType, scenario_path: Path) -> None:
    """Состав активных аппаратов совпадает с эталонным на контрольных отсчётах."""
    raw = read_json(scenario_path)
    scenario = load(scenario_path)
    plan = contacts.build(scenario)
    for t_s in CROSSCHECK_TIMES_S:
        snapshot = reference.snapshot(raw, float(t_s))
        expected = {item["id"] for item in snapshot["satellites"] if item["active"]}
        tick = t_s // scenario.environment.step_s
        actual = {
            plan.nodes[index]
            for index in range(plan.satellite_count)
            if bool(plan.active[tick, index])
        }
        assert actual == expected
