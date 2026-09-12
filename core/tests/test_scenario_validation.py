"""Валидация, канонизация и config_hash сценария `cosmo-A-1.0`."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final

import pytest

from orbita_core.scenario import (
    ErrorCode,
    ScenarioError,
    canonical_json,
    config_hash,
    load,
    parse,
    to_dict,
    validate,
)
from tests.support import FIXTURES_DIR, SCENARIO_PATHS, read_json, synthetic_scenario

# Таблица негативных фикстур из `10_FIXTURES.md` §3: файл → ожидаемые (код, path).
EXPECTED_ISSUES: Final[dict[str, tuple[tuple[ErrorCode, str], ...]]] = {
    "bad_schema.json": ((ErrorCode.UNSUPPORTED_SCHEMA_VERSION, "schema_version"),),
    "bad_step.json": ((ErrorCode.INVALID_TIME_GRID, "environment.step_s"),),
    "bad_horizon.json": ((ErrorCode.INVALID_TIME_GRID, "environment.horizon_s"),),
    "bad_raan.json": ((ErrorCode.INVALID_SCENARIO_FIELD, "design.planes[1].raan_deg"),),
    "dup_sat.json": ((ErrorCode.DUPLICATE_NODE_ID, "design.satellites[5].id"),),
    "bad_plane_ref.json": ((ErrorCode.UNRESOLVED_REFERENCE, "design.satellites[0].plane_id"),),
    "bad_failure_ref.json": ((ErrorCode.UNRESOLVED_REFERENCE, "failures[0].satellite_id"),),
    "bad_interval.json": ((ErrorCode.INVALID_OUTAGE_INTERVAL, "failures[0]"),),
    "no_gateway.json": ((ErrorCode.MISSING_SITE_ROLE, "ground_sites"),),
    "nan_lat.json": ((ErrorCode.INVALID_SCENARIO_FIELD, "ground_sites[2].lat_deg"),),
    "multi_errors.json": (
        (ErrorCode.INVALID_SCENARIO_FIELD, "environment.min_elevation_deg"),
        (ErrorCode.UNRESOLVED_REFERENCE, "design.satellites[0].plane_id"),
        (ErrorCode.INVALID_OUTAGE_INTERVAL, "failures[0]"),
    ),
}


@pytest.mark.parametrize("fixture_name", sorted(EXPECTED_ISSUES))
def test_negative_fixture_reports_expected_codes_and_paths(fixture_name: str) -> None:
    """Каждая фикстура даёт ровно те ошибки и пути, что записаны в документе.

    Проверяется весь список, а не вхождение: лишние ошибки — тоже дефект, инженер по
    ним будет править исправные поля.
    """
    issues = validate(read_json(FIXTURES_DIR / fixture_name))
    assert [(issue.code, issue.path) for issue in issues] == list(EXPECTED_ISSUES[fixture_name])


def test_multi_errors_returns_three_errors_at_once() -> None:
    """Валидация не останавливается на первой ошибке."""
    with pytest.raises(ScenarioError) as error:
        load(FIXTURES_DIR / "multi_errors.json")
    assert len(error.value.errors) == 3


def test_every_issue_carries_message() -> None:
    """Сообщение — то, что увидит инженер, поэтому пустым оно быть не может."""
    for fixture_name in EXPECTED_ISSUES:
        for issue in validate(read_json(FIXTURES_DIR / fixture_name)):
            assert issue.message


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_bundled_scenarios_are_valid(scenario_path: Path) -> None:
    """Сценарии кейса проходят валидацию без единого замечания."""
    assert validate(read_json(scenario_path)) == []


@pytest.mark.parametrize("scenario_path", SCENARIO_PATHS, ids=lambda path: str(path.stem))
def test_canonical_form_is_idempotent(scenario_path: Path) -> None:
    """Повторный разбор канонического JSON даёт тот же канонический JSON."""
    first = canonical_json(load(scenario_path))
    second = canonical_json(parse(json.loads(first)))
    assert first == second


def test_scenario_grid_excludes_right_edge() -> None:
    """Отсчёт `horizon_s` в сетку не входит, отсчёт `t = 0` входит."""
    scenario = parse(synthetic_scenario(horizon_s=1200, step_s=120))
    assert scenario.ticks == 10
    assert scenario.times_s[0] == 0.0
    assert scenario.times_s[-1] == 1080.0


def test_angles_are_normalized_to_single_turn() -> None:
    """Слот, заданный больше оборота, приводится к [0; 360)."""
    data = synthetic_scenario(satellite_count=2)
    data["design"]["satellites"][0]["slot_deg"] = 400.0
    data["environment"]["earth_angle0_deg"] = -30.0
    scenario = parse(data)
    assert scenario.satellites[0].slot_deg == pytest.approx(40.0)
    assert scenario.environment.earth_angle0_deg == pytest.approx(330.0)


def test_ground_site_horizon_override_round_trips_and_old_shape_is_preserved() -> None:
    """Локальный порог сериализуется, а старый сценарий не получает лишнее поле."""
    legacy = parse(synthetic_scenario())
    assert "min_elevation_deg" not in to_dict(legacy)["ground_sites"][0]

    data = synthetic_scenario()
    data["ground_sites"][1]["min_elevation_deg"] = 25.0
    scenario = parse(data)
    assert scenario.ground_sites[1].min_elevation_deg == pytest.approx(25.0)
    assert to_dict(scenario)["ground_sites"][1]["min_elevation_deg"] == pytest.approx(25.0)


def test_lists_are_sorted_by_id() -> None:
    """Порядок объектов в файле не влияет на канонический вид и на хеш."""
    straight = synthetic_scenario(satellite_count=4)
    shuffled = synthetic_scenario(satellite_count=4)
    shuffled["design"]["satellites"].reverse()
    shuffled["ground_sites"].reverse()
    assert canonical_json(parse(straight)) == canonical_json(parse(shuffled))


def test_overlapping_failures_are_merged() -> None:
    """Пересекающиеся и смежные интервалы одного аппарата сливаются в один."""
    scenario = parse(
        synthetic_scenario(
            satellite_count=3,
            failures=[
                {"satellite_id": "SAT-01", "start_s": 300.0, "end_s": 900.0},
                {"satellite_id": "SAT-01", "start_s": 0.0, "end_s": 600.0},
                {"satellite_id": "SAT-01", "start_s": 900.0, "end_s": 1200.0},
                {"satellite_id": "SAT-02", "start_s": 0.0, "end_s": 120.0},
            ],
        )
    )
    assert [(item.node_id, item.start_s, item.end_s) for item in scenario.failures] == [
        ("SAT-01", 0.0, 1200.0),
        ("SAT-02", 0.0, 120.0),
    ]


def test_merged_failures_give_the_same_config_hash() -> None:
    """Инвариант 13 `10_FIXTURES.md`: разбиение интервала не меняет конфигурацию."""
    split = parse(
        synthetic_scenario(
            failures=[
                {"satellite_id": "SAT-00", "start_s": 0.0, "end_s": 600.0},
                {"satellite_id": "SAT-00", "start_s": 600.0, "end_s": 1200.0},
            ]
        )
    )
    whole = parse(
        synthetic_scenario(failures=[{"satellite_id": "SAT-00", "start_s": 0.0, "end_s": 1200.0}])
    )
    assert config_hash(split, "bfs_shortest") == config_hash(whole, "bfs_shortest")


def test_config_hash_depends_on_routing_policy() -> None:
    """Политика входит в ключ: разные политики дают разные маршруты и метрики."""
    scenario = parse(synthetic_scenario())
    assert config_hash(scenario, "bfs_shortest") != config_hash(scenario, "persistent")


@pytest.mark.parametrize(
    ("section", "key", "value"),
    [
        ("environment", "isl_range_km", 2000.0),
        ("environment", "min_elevation_deg", 15.0),
        ("environment", "altitude_km", 600.0),
        ("design", "launch_stage", 2),
    ],
)
def test_config_hash_changes_with_any_parameter(section: str, key: str, value: object) -> None:
    """Любой параметр расчёта меняет хеш, иначе Run переиспользуется ошибочно."""
    base = parse(synthetic_scenario(satellite_count=6, launch_batches=[1, 1, 2, 2, 3, 3]))
    changed_data = synthetic_scenario(satellite_count=6, launch_batches=[1, 1, 2, 2, 3, 3])
    changed_data[section][key] = value
    changed = parse(changed_data)
    assert config_hash(base, "bfs_shortest") != config_hash(changed, "bfs_shortest")


def test_missing_failures_section_is_an_error() -> None:
    """Отсутствие `failures` меняло бы результат расчёта молча, поэтому это ошибка."""
    data = synthetic_scenario()
    del data["failures"]
    issues = validate(data)
    assert [(issue.code, issue.path) for issue in issues] == [
        (ErrorCode.INVALID_SCENARIO_FIELD, "failures")
    ]


def test_ground_site_id_may_not_collide_with_satellite_id() -> None:
    """Идентификаторы аппаратов и пунктов живут в одном пространстве имён графа."""
    data = synthetic_scenario(satellite_count=2)
    data["ground_sites"][0]["id"] = "SAT-00"
    issues = validate(data)
    assert [(issue.code, issue.path) for issue in issues] == [
        (ErrorCode.DUPLICATE_NODE_ID, "ground_sites[0].id")
    ]


def test_failure_outside_horizon_is_rejected() -> None:
    """Интервал недоступности должен лежать внутри расчётного периода."""
    data = synthetic_scenario(
        horizon_s=1200, failures=[{"satellite_id": "SAT-00", "start_s": 0.0, "end_s": 1800.0}]
    )
    issues = validate(data)
    assert [(issue.code, issue.path) for issue in issues] == [
        (ErrorCode.INVALID_OUTAGE_INTERVAL, "failures[0]")
    ]


def test_derived_indexes_follow_sorted_order() -> None:
    """Производные индексы согласованы со списками сценария."""
    scenario = parse(synthetic_scenario(satellite_count=3))
    assert scenario.satellite_index == {"SAT-00": 0, "SAT-01": 1, "SAT-02": 2}
    assert scenario.plane_of_satellite == (0, 1, 0)
    assert scenario.client_ids == ("TERM-EAST",)
    assert scenario.gateway_ids == ("GW-NORTH",)
