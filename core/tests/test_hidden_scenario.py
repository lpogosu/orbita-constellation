"""Скрытый сценарий жюри (ADR-015, 10_FIXTURES.md §2 п. 20).

Жюри загрузит собственный файл формата `cosmo-A-1.0` с другими идентификаторами и
координатами. `scenarios/hidden_like.json` — такой файл, собранный заранее: он нужен,
чтобы падение на чужих данных обнаружилось в CI, а не на демонстрации.
"""

import importlib.util
import json
from functools import cache
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
HIDDEN_SCENARIO_PATH = REPO_ROOT / "scenarios" / "hidden_like.json"
CASE_SCENARIO_PATHS = sorted((REPO_ROOT / "scenarios").glob("0*.json"))

EXPECTED_SATELLITES = 35
EXPECTED_PLANES = 5
EXPECTED_GATEWAYS = 2
EXPECTED_CLIENTS = 4

# Отсчёты для проверки невырожденности: начало горизонта и его середина.
PROBE_TICKS_S = (0.0, 43200.0)


REFERENCE_MODULE_PATH = REPO_ROOT / "case" / "geometry" / "geometry.py"
REFERENCE_MISSING_REASON = (
    f"эталонный модуль кейсодержателя не найден: {REFERENCE_MODULE_PATH}. "
    "Это материал организаторов, он не входит в репозиторий."
)


@cache
def _load_reference_geometry() -> ModuleType:
    """Эталонный модуль кейсодержателя лежит вне пакета и загружается по пути.

    Загрузка ленивая: модуль нужен двум тестам из семи, а в репозиторий он не входит —
    это чужая интеллектуальная собственность. Остальные пять проверок формата от него
    не зависят и должны идти всегда.

    Тип — `ModuleType`, то есть его атрибуты для mypy остаются `Any`: у эталона нет ни
    аннотаций, ни stub-файла, а описывать протокол ради трёх вызовов в одном тесте
    дороже, чем потерять здесь статическую типизацию.
    """
    spec = importlib.util.spec_from_file_location(
        "case_reference_geometry", REFERENCE_MODULE_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить эталонный модуль: {REFERENCE_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


requires_reference = pytest.mark.skipif(
    not REFERENCE_MODULE_PATH.is_file(), reason=REFERENCE_MISSING_REASON
)


def _read_scenario(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TypeError(f"Сценарий должен быть объектом JSON: {path}")
    return data


def _node_ids(scenario: dict[str, Any]) -> set[str]:
    """Идентификаторы плоскостей, спутников и наземных пунктов в одном множестве."""
    design = scenario["design"]
    ids = {str(plane["id"]) for plane in design["planes"]}
    ids |= {str(satellite["id"]) for satellite in design["satellites"]}
    ids |= {str(site["id"]) for site in scenario["ground_sites"]}
    return ids


def _site_points(scenario: dict[str, Any]) -> set[tuple[float, float]]:
    return {(float(site["lat_deg"]), float(site["lon_deg"])) for site in scenario["ground_sites"]}


HIDDEN: dict[str, Any] = _read_scenario(HIDDEN_SCENARIO_PATH)


def test_case_scenarios_are_present() -> None:
    """Сравнивать скрытый сценарий не с чем, если файлы кейса не найдены."""
    assert len(CASE_SCENARIO_PATHS) == 4


@requires_reference
def test_hidden_scenario_passes_reference_validation() -> None:
    """`validate` кейсодержателя — единственный обязательный критерий формата."""
    _load_reference_geometry().validate(HIDDEN)


def test_hidden_scenario_has_expected_shape() -> None:
    design = HIDDEN["design"]
    roles = [site["role"] for site in HIDDEN["ground_sites"]]
    assert len(design["satellites"]) == EXPECTED_SATELLITES
    assert len(design["planes"]) == EXPECTED_PLANES
    assert roles.count("gateway") == EXPECTED_GATEWAYS
    assert roles.count("client") == EXPECTED_CLIENTS


def test_hidden_scenario_launch_stages_are_non_empty() -> None:
    """Этапы 1 и 2 должны давать непустые подмножества, иначе сценарий не проверяет ADR-015."""
    batches = [int(satellite["launch_batch"]) for satellite in HIDDEN["design"]["satellites"]]
    assert set(batches) == {1, 2, 3}
    assert int(HIDDEN["design"]["launch_stage"]) == 3


def test_hidden_scenario_ids_do_not_overlap_case_scenarios() -> None:
    """Совпадение хотя бы одного идентификатора позволило бы коду опереться на `S01`/`C65`."""
    case_ids: set[str] = set()
    for path in CASE_SCENARIO_PATHS:
        case_ids |= _node_ids(_read_scenario(path))
    assert _node_ids(HIDDEN) & case_ids == set()


def test_hidden_scenario_sites_have_own_coordinates() -> None:
    case_points: set[tuple[float, float]] = set()
    for path in CASE_SCENARIO_PATHS:
        case_points |= _site_points(_read_scenario(path))
    assert _site_points(HIDDEN) & case_points == set()


@requires_reference
def test_hidden_scenario_network_is_not_degenerate() -> None:
    """Без наземных и межспутниковых рёбер фикстура прошла бы валидацию, но ничего не проверяла."""
    satellite_ids = {str(satellite["id"]) for satellite in HIDDEN["design"]["satellites"]}
    for tick_s in PROBE_TICKS_S:
        edges = _load_reference_geometry().snapshot(HIDDEN, tick_s)["edges"]
        ground_edges = [edge for edge in edges if edge[0] not in satellite_ids]
        isl_edges = [edge for edge in edges if edge[0] in satellite_ids]
        assert ground_edges, f"нет наземных рёбер на отсчёте {tick_s}"
        assert isl_edges, f"нет ISL-рёбер на отсчёте {tick_s}"
