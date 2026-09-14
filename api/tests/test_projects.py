"""Проекты, варианты и валидация сценария на живой базе (`05_API.md` §1-3).

Ни одного идентификатора из сценариев кейса и ни одного числа из них: всё, с чем
сравнивается ответ, берётся из загруженного файла. Иначе тест проверял бы конкретный
файл, а не сервис, и падал бы на сценарии жюри (ADR-015).
"""

from copy import deepcopy
from typing import Any, Final
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from conftest import read_json

pytestmark = pytest.mark.usefixtures("clean_database")

CASE_SCENARIO: Final[str] = "scenarios/01_full_constellation.json"
BAD_RAAN_FIXTURE: Final[str] = "core/tests/fixtures/bad_raan.json"
MULTI_ERROR_FIXTURE: Final[str] = "core/tests/fixtures/multi_errors.json"

FULL_TURN_DEG: Final[float] = 360.0
RAAN_SHIFT_DEG: Final[float] = 12.0
SHA256_LENGTH: Final[int] = 64


def create_project(
    client: TestClient,
    scenario: dict[str, Any],
    title: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"scenario": scenario}
    if title is not None:
        body["title"] = title
    response = client.post("/api/projects", json=body)
    assert response.status_code == 201, response.text
    return dict(response.json())


def project_detail(client: TestClient, project_id: str) -> dict[str, Any]:
    response = client.get(f"/api/projects/{project_id}")
    assert response.status_code == 200, response.text
    return dict(response.json())


def effective_scenario(client: TestClient, variant_id: str) -> dict[str, Any]:
    """Канонический сценарий варианта — то, что реально пойдёт в расчёт."""
    response = client.get(f"/api/variants/{variant_id}/export")
    assert response.status_code == 200, response.text
    return dict(response.json())


def test_validate_describes_the_loaded_file(client: TestClient) -> None:
    scenario = read_json(CASE_SCENARIO)

    response = client.post("/api/scenarios/validate", json=scenario)

    assert response.status_code == 200, response.text
    summary = response.json()
    environment = scenario["environment"]
    design = scenario["design"]
    assert summary["schema_version"] == scenario["schema_version"]
    assert summary["plane_count"] == len(design["planes"])
    assert summary["satellite_count"] == len(design["satellites"])
    assert summary["active_satellite_count"] == sum(
        1
        for satellite in design["satellites"]
        if satellite["launch_batch"] <= design["launch_stage"]
    )
    assert summary["client_count"] == sum(
        1 for site in scenario["ground_sites"] if site["role"] == "client"
    )
    assert summary["gateway_count"] == sum(
        1 for site in scenario["ground_sites"] if site["role"] == "gateway"
    )
    assert summary["total_ticks"] == environment["horizon_s"] // environment["step_s"]
    assert len(summary["config_hash"]) == SHA256_LENGTH


def test_validate_names_the_field_rejected_by_the_core(client: TestClient) -> None:
    scenario = read_json(BAD_RAAN_FIXTURE)
    index, _ = next(
        (position, plane)
        for position, plane in enumerate(scenario["design"]["planes"])
        if not 0.0 <= plane["raan_deg"] < FULL_TURN_DEG
    )

    response = client.post("/api/scenarios/validate", json=scenario)

    assert response.status_code == 400, response.text
    errors = response.json()["errors"]
    assert len(errors) == 1
    assert errors[0]["code"] == "INVALID_SCENARIO_FIELD"
    assert errors[0]["path"] == f"design.planes[{index}].raan_deg"
    assert errors[0]["details"]


def test_validate_returns_every_error_at_once(client: TestClient) -> None:
    """Инженер правит файл за один проход, поэтому список ошибок полный."""
    response = client.post("/api/scenarios/validate", json=read_json(MULTI_ERROR_FIXTURE))

    assert response.status_code == 400, response.text
    errors = response.json()["errors"]
    assert len(errors) > 1
    assert all(error["path"] for error in errors)
    assert len({error["path"] for error in errors}) == len(errors)


def test_missing_failures_section_is_an_input_error(client: TestClient) -> None:
    """Раздел обязателен: ядро и эталонный расчётный модуль читают его без проверки."""
    scenario = read_json(CASE_SCENARIO)
    del scenario["failures"]

    response = client.post("/api/scenarios/validate", json=scenario)

    assert response.status_code == 400, response.text
    assert [error["path"] for error in response.json()["errors"]] == ["failures"]


def test_created_project_holds_the_first_variant(client: TestClient) -> None:
    scenario = read_json(CASE_SCENARIO)
    summary = client.post("/api/scenarios/validate", json=scenario).json()

    project = create_project(client, scenario)
    detail = project_detail(client, project["id"])

    assert project["title"] == scenario["meta"]["title"]
    assert len(detail["variants"]) == 1
    variant = detail["variants"][0]
    assert variant["parent_variant_id"] is None
    assert variant["diff_from_parent"] == []
    # Хэш варианта считается от канонического сценария и не зависит от того, пришёл файл
    # в проверку или сразу в проект.
    assert variant["config_hash"] == summary["config_hash"]
    assert detail["project"]["active_variant_id"] == variant["id"]
    assert detail["recent_runs"] == []


def test_explicit_title_wins_over_the_scenario(client: TestClient) -> None:
    project = create_project(client, read_json(CASE_SCENARIO), title="Полярная группировка")

    assert project["title"] == "Полярная группировка"


def test_invalid_scenario_creates_nothing(client: TestClient) -> None:
    response = client.post("/api/projects", json={"scenario": read_json(BAD_RAAN_FIXTURE)})

    assert response.status_code == 400, response.text
    assert response.json()["errors"][0]["code"] == "INVALID_SCENARIO_FIELD"
    assert client.get("/api/projects").json() == []


def test_saved_variant_diff_names_only_the_changed_parameter(client: TestClient) -> None:
    project = create_project(client, read_json(CASE_SCENARIO))
    # Правка делается по каноническому сценарию: индекс в пути diff считается по нему же.
    canonical = effective_scenario(client, project["active_variant_id"])
    changed = deepcopy(canonical)
    before = changed["design"]["planes"][0]["raan_deg"]
    after = (before + RAAN_SHIFT_DEG) % FULL_TURN_DEG
    changed["design"]["planes"][0]["raan_deg"] = after

    response = client.post(
        f"/api/projects/{project['id']}/variants",
        json={"title": "Сдвиг первой плоскости", "scenario": changed},
    )

    assert response.status_code == 201, response.text
    variant = response.json()
    assert variant["diff_from_parent"] == [
        {"path": "design.planes[0].raan_deg", "from": before, "to": after},
    ]
    assert variant["parent_variant_id"] == project["active_variant_id"]
    assert variant["config_hash"] != canonical_hash(client, project["active_variant_id"])


def canonical_hash(client: TestClient, variant_id: str) -> str:
    response = client.get(f"/api/variants/{variant_id}")
    assert response.status_code == 200, response.text
    return str(response.json()["config_hash"])


def test_saved_variant_becomes_active(client: TestClient) -> None:
    project = create_project(client, read_json(CASE_SCENARIO))
    canonical = effective_scenario(client, project["active_variant_id"])

    response = client.post(f"/api/projects/{project['id']}/variants", json={"scenario": canonical})

    variant = response.json()
    detail = project_detail(client, project["id"])
    assert detail["project"]["active_variant_id"] == variant["id"]
    assert len(detail["variants"]) == 2


def test_unchanged_scenario_still_creates_a_variant(client: TestClient) -> None:
    """Пользователь нажал «сохранить»: отказ выглядел бы потерей работы."""
    project = create_project(client, read_json(CASE_SCENARIO))
    parent_id = project["active_variant_id"]
    canonical = effective_scenario(client, parent_id)

    response = client.post(f"/api/projects/{project['id']}/variants", json={"scenario": canonical})

    assert response.status_code == 201, response.text
    variant = response.json()
    assert variant["diff_from_parent"] == []
    assert variant["config_hash"] == canonical_hash(client, parent_id)


def test_exported_scenario_passes_validation(client: TestClient) -> None:
    """Требование кейса: изменённый сценарий выгружается и загружается обратно."""
    project = create_project(client, read_json(CASE_SCENARIO))
    canonical = effective_scenario(client, project["active_variant_id"])

    response = client.post("/api/scenarios/validate", json=canonical)

    assert response.status_code == 200, response.text
    assert response.json()["config_hash"] == canonical_hash(client, project["active_variant_id"])


def test_lineage_links_the_variant_to_its_parent(client: TestClient) -> None:
    project = create_project(client, read_json(CASE_SCENARIO))
    parent_id = project["active_variant_id"]
    changed = deepcopy(effective_scenario(client, parent_id))
    changed["design"]["planes"][0]["phase_deg"] = (
        changed["design"]["planes"][0]["phase_deg"] + RAAN_SHIFT_DEG
    ) % FULL_TURN_DEG
    child = client.post(
        f"/api/projects/{project['id']}/variants",
        json={"scenario": changed},
    ).json()

    response = client.get(f"/api/projects/{project['id']}/lineage")

    assert response.status_code == 200, response.text
    lineage = response.json()
    assert {node["variant_id"] for node in lineage["nodes"]} == {parent_id, child["id"]}
    assert len(lineage["edges"]) == 1
    edge = lineage["edges"][0]
    assert edge["parent_variant_id"] == parent_id
    assert edge["child_variant_id"] == child["id"]
    assert [change["path"] for change in edge["diff"]] == ["design.planes[0].phase_deg"]
    # Дельты метрик появятся вместе с сохранёнными Run.
    assert edge["delta_min_availability"] is None
    assert edge["delta_worst_max_gap_s"] is None


def test_unknown_project_is_not_found(client: TestClient) -> None:
    missing = uuid4()

    response = client.get(f"/api/projects/{missing}")

    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert error["details"] == {"id": str(missing)}


def test_unknown_variant_is_not_found(client: TestClient) -> None:
    response = client.get(f"/api/variants/{uuid4()}")

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_variant_of_another_project_cannot_be_a_parent(client: TestClient) -> None:
    scenario = read_json(CASE_SCENARIO)
    first = create_project(client, scenario)
    second = create_project(client, scenario, title="Второй проект")

    response = client.post(
        f"/api/projects/{second['id']}/variants",
        json={"scenario": scenario, "parent_variant_id": first["active_variant_id"]},
    )

    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_projects_are_listed_newest_first(client: TestClient) -> None:
    scenario = read_json(CASE_SCENARIO)
    older = create_project(client, scenario, title="Первый")
    newer = create_project(client, scenario, title="Второй")

    listed = client.get("/api/projects").json()

    assert [project["id"] for project in listed] == [newer["id"], older["id"]]
