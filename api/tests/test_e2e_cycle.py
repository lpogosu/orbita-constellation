"""Полный цикл по OpenAPI на поднятом стеке, без фронтенда.

`validate → project → run → snapshot → timeline → outages → backup-paths → export →
validate экспорта → второй вариант → comparisons → recommendation → evidence-pack`.

Адрес берётся из `ORBITA_TEST_API_URL` (по умолчанию `http://localhost:8000`). Если api не
отвечает, тесты помечаются `skip`: образ проверок собирается без поднятого стека, и
`make test` в нём обязан оставаться зелёным.

Золотые значения не повторяются литералами: доступность трёх клиентов читается из таблицы
`docs/10_FIXTURES.md` §1, остальные проверки — инварианты `10_FIXTURES.md` §2, которые
считаются из самого ответа.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import time
import zipfile
from collections.abc import Iterator
from itertools import pairwise
from typing import Any, Final

import httpx2
import numpy as np
import pytest

from conftest import read_json, repository_path

API_URL_ENV: Final[str] = "ORBITA_TEST_API_URL"
DEFAULT_API_URL: Final[str] = "http://localhost:8000"

CASE_SCENARIO: Final[str] = "scenarios/01_full_constellation.json"
HIDDEN_SCENARIO: Final[str] = "scenarios/hidden_like.json"

# Идентификатор, которого в базе заведомо нет: UUID, не выданный ни одному запуску.
UNKNOWN_RUN_ID: Final[str] = "3c8f1c2e-4a55-4d1b-9f77-5b6c7d8e9f00"

# Сутки сценария ядро считает меньше секунды, запас нужен на очередь и запись результата.
RUN_TIMEOUT_S: Final[float] = 120.0
POLL_STEP_S: Final[float] = 0.2
REQUEST_TIMEOUT_S: Final[float] = 60.0

# Доли сравниваются с точностью таблицы фикстур: в ней четыре знака после запятой.
AVAILABILITY_TOLERANCE: Final[float] = 1e-4

# Отсчёты, на которых проверяется снимок: начало, середина и конец горизонта.
SAMPLE_FRACTIONS: Final[tuple[float, ...]] = (0.0, 0.5, 1.0)

# Строка таблицы `10_FIXTURES.md` §1: сценарий (только в первой строке группы), клиент и
# четыре числа. Разделитель дробной части — запятая, разряды отделены пробелом.
_FIXTURE_ROW: Final[re.Pattern[str]] = re.compile(
    r"^\|\s*(?:`(?P<scenario>[\w]+)`)?\s*\|\s*(?P<client>[\w]+)\s*"
    r"\|\s*(?P<availability>[\d,\s  ]+)\s*"
    r"\|\s*(?P<visibility>[\d,\s  ]+)\s*"
    r"\|\s*(?P<max_gap_s>[\d,\s  ]+)\s*"
    r"\|\s*(?P<mean_hops>[\d,\s  ]+)\s*\|",
)


def _number(cell: str) -> float:
    """Число таблицы документа: запятая — дробная часть, пробелы — разряды."""
    return float(re.sub(r"[\s  ]", "", cell).replace(",", "."))


def golden_availability(stem: str) -> dict[str, float]:
    """Доступность клиентов сценария из таблицы `docs/10_FIXTURES.md` §1."""
    lines = repository_path("docs/10_FIXTURES.md").read_text(encoding="utf-8").splitlines()
    values: dict[str, float] = {}
    current: str | None = None
    for line in lines:
        matched = _FIXTURE_ROW.match(line)
        if matched is None:
            continue
        if matched.group("scenario"):
            current = matched.group("scenario")
        if current == stem:
            values[matched.group("client")] = _number(matched.group("availability"))
    if not values:
        raise AssertionError(f"в docs/10_FIXTURES.md нет строк сценария {stem}")
    return values


@pytest.fixture(scope="session")
def api() -> Iterator[httpx2.Client]:
    base_url = os.environ.get(API_URL_ENV, DEFAULT_API_URL)
    client = httpx2.Client(base_url=base_url, timeout=REQUEST_TIMEOUT_S)
    try:
        response = client.get("/api/health")
        response.raise_for_status()
    except Exception as error:
        client.close()
        pytest.skip(f"Стек не отвечает на {base_url}: {error}")
    try:
        yield client
    finally:
        client.close()


def _json(response: httpx2.Response) -> dict[str, Any]:
    """Тело успешного ответа; неуспешный ответ печатается целиком в сообщении об ошибке."""
    assert response.status_code < 400, f"{response.status_code}: {response.text}"
    return dict(response.json())


def _json_list(response: httpx2.Response) -> list[dict[str, Any]]:
    assert response.status_code < 400, f"{response.status_code}: {response.text}"
    return [dict(item) for item in response.json()]


def create_project(api: httpx2.Client, scenario: dict[str, Any], title: str) -> str:
    """Создаёт проект и возвращает идентификатор его активного варианта."""
    project = _json(api.post("/api/projects", json={"title": title, "scenario": scenario}))
    assert project["active_variant_id"] is not None
    return str(project["active_variant_id"])


def start_run(api: httpx2.Client, variant_id: str) -> dict[str, Any]:
    response = api.post("/api/runs", json={"variant_id": variant_id})
    assert response.status_code in {200, 202}, response.text
    return dict(response.json())


def await_success(api: httpx2.Client, run_id: str) -> dict[str, Any]:
    """Ждёт завершения расчёта опросом состояния (`05_API.md` §4)."""
    deadline = time.monotonic() + RUN_TIMEOUT_S
    state: dict[str, Any] = {}
    while time.monotonic() < deadline:
        state = dict(_json(api.get(f"/api/runs/{run_id}")))
        if state["status"] == "succeeded":
            return state
        assert state["status"] in {"queued", "running"}, state
        time.sleep(POLL_STEP_S)
    raise AssertionError(f"Расчёт {run_id} не завершился за {RUN_TIMEOUT_S} с: {state}")


def calculated_run(api: httpx2.Client, variant_id: str) -> dict[str, Any]:
    return await_success(api, str(start_run(api, variant_id)["id"]))


def unpack_bitset(bitset: str, total_ticks: int) -> np.ndarray:
    packed = np.frombuffer(base64.b64decode(bitset), dtype=np.uint8)
    return np.unpackbits(packed)[:total_ticks].astype(bool)


def sample_ticks(total_ticks: int, step_s: int) -> list[int]:
    return [
        min(int(fraction * total_ticks), total_ticks - 1) * step_s
        for fraction in SAMPLE_FRACTIONS
    ]


def shifted_raan(scenario: dict[str, Any], delta_deg: float) -> tuple[dict[str, Any], str]:
    """Копия сценария со сдвинутым RAAN второй плоскости и путь изменённого поля."""
    changed = json.loads(json.dumps(scenario))
    planes = changed["design"]["planes"]
    index = 1 if len(planes) > 1 else 0
    planes[index]["raan_deg"] = (planes[index]["raan_deg"] + delta_deg) % 360.0
    return changed, f"design.planes[{index}].raan_deg"


@pytest.mark.parametrize(
    "relative",
    [CASE_SCENARIO, HIDDEN_SCENARIO],
    ids=["case", "hidden"],
)
def test_full_cycle_from_validation_to_evidence_pack(api: httpx2.Client, relative: str) -> None:
    scenario = read_json(relative)
    stem = relative.rsplit("/", 1)[-1].removesuffix(".json")

    summary = _json(api.post("/api/scenarios/validate", json=scenario))
    total_ticks = int(summary["total_ticks"])
    horizon_s = int(scenario["environment"]["horizon_s"])
    step_s = int(scenario["environment"]["step_s"])
    assert total_ticks == horizon_s // step_s

    variant_id = create_project(api, scenario, f"Полный цикл {stem}")
    run = calculated_run(api, variant_id)
    run_id = str(run["id"])
    assert run["completed_ticks"] == total_ticks

    metrics = _json(api.get(f"/api/runs/{run_id}/metrics"))
    availability = {item["client_id"]: item["availability"] for item in metrics["clients"]}
    assert availability
    assert metrics["config"]["min_client_availability"] == pytest.approx(
        min(availability.values()),
        abs=AVAILABILITY_TOLERANCE,
    )

    gateways = {
        site["id"] for site in scenario["ground_sites"] if site["role"] == "gateway"
    }
    _assert_snapshots_agree_with_edges(api, run_id, total_ticks, step_s, gateways)
    _assert_timeline_matches_metrics(api, run_id, metrics, total_ticks)
    _assert_outages_fill_the_gap(api, run_id, availability, horizon_s)
    _assert_backup_paths_exist_where_route_does(api, run_id, total_ticks, step_s)

    document = _export(api, run_id)
    assert document["schema_version"] == "cosmo-A-result-1.0"
    assert document["run_id"] == run_id
    assert document["routing_policy"] == run["routing_policy"]
    assert document["engine_version"] == run["engine_version"]
    assert document["recommendation"] is None
    assert document["metrics"]["clients"]
    _json(api.post("/api/scenarios/validate", json=document["effective_scenario"]))

    # Повторный запуск той же конфигурации переиспользует готовый Run (ADR-011).
    repeated = api.post("/api/runs", json={"variant_id": variant_id})
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["id"] == run_id


def test_case_metrics_match_the_fixtures_table(api: httpx2.Client) -> None:
    """Доступность трёх клиентов совпадает с таблицей `docs/10_FIXTURES.md` §1."""
    scenario = read_json(CASE_SCENARIO)
    variant_id = create_project(api, scenario, "Сверка с таблицей фикстур")

    run = calculated_run(api, variant_id)
    metrics = _json(api.get(f"/api/runs/{run['id']}/metrics"))

    expected = golden_availability("01_full_constellation")
    counted = {item["client_id"]: item["availability"] for item in metrics["clients"]}
    assert set(counted) == set(expected)
    for client_id, value in expected.items():
        assert counted[client_id] == pytest.approx(value, abs=AVAILABILITY_TOLERANCE)


def test_comparison_recommendation_and_evidence_pack(api: httpx2.Client) -> None:
    """Второй вариант с другим RAAN: сравнение, рекомендация и архив по одной паре."""
    scenario = read_json(HIDDEN_SCENARIO)
    base_variant_id = create_project(api, scenario, "Сравнение вариантов")
    base_run = calculated_run(api, base_variant_id)

    changed, changed_path = shifted_raan(scenario, 12.0)
    project = _json(api.get(f"/api/variants/{base_variant_id}"))["project_id"]
    variant = _json(
        api.post(
            f"/api/projects/{project}/variants",
            json={"title": "Сдвиг ориентации плоскости", "scenario": changed},
        ),
    )
    assert [item["path"] for item in variant["diff_from_parent"]] == [changed_path]
    candidate_run = calculated_run(api, str(variant["id"]))

    comparison = _json(
        api.post(
            "/api/comparisons",
            json={"run_ids": [base_run["id"], candidate_run["id"]]},
        ),
    )
    assert comparison["base_run_id"] == base_run["id"]
    assert [entry["run_id"] for entry in comparison["entries"]] == [
        base_run["id"],
        candidate_run["id"],
    ]
    assert comparison["entries"][0]["changed_parameters"] == []
    assert [item["path"] for item in comparison["entries"][1]["changed_parameters"]] == [
        changed_path,
    ]
    assert comparison["entries"][1]["deltas"]
    assert comparison["entries"][1]["per_client"]

    recommendation = _json(
        api.get(
            f"/api/runs/{candidate_run['id']}/recommendation",
            params={"base_run_id": base_run["id"]},
        ),
    )
    assert recommendation["base_run_id"] == base_run["id"]
    assert recommendation["recommended_run_id"] in {base_run["id"], candidate_run["id"]}
    assert recommendation["ranking_order"][0] == "min_client_availability"
    assert recommendation["limitations"]
    assert recommendation["per_client"]

    response = api.get(
        f"/api/runs/{candidate_run['id']}/evidence-pack",
        params={"base_run_id": base_run["id"]},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert names == {
            "export.json",
            "metrics.json",
            "outages.json",
            "comparison.json",
            "recommendation.json",
            "engine_version.txt",
        }
        for name in names - {"engine_version.txt"}:
            assert json.loads(archive.read(name)) is not None
        assert archive.read("engine_version.txt").decode("utf-8").strip()


def test_preview_matches_the_snapshot_of_the_same_configuration(api: httpx2.Client) -> None:
    """Просмотр черновика и снимок посчитанного запуска на одном отсчёте совпадают."""
    scenario = read_json(HIDDEN_SCENARIO)
    step_s = int(scenario["environment"]["step_s"])
    t_s = step_s * 3
    variant_id = create_project(api, scenario, "Просмотр черновика")
    run = calculated_run(api, variant_id)

    snapshot = _json(api.get(f"/api/runs/{run['id']}/snapshot", params={"t_s": t_s}))
    preview = _json(api.post("/api/preview", json={"scenario": scenario, "t_s": t_s}))

    assert preview["t_s"] == snapshot["t_s"]
    assert preview["satellites"] == snapshot["satellites"]
    assert preview["clients"] == snapshot["clients"]
    # Длины линий у снимка восстановлены из трассы, у просмотра посчитаны заново: это одна
    # и та же геометрия, но разный порядок операций с плавающей точкой.
    assert _edge_map(preview["edges"]).keys() == _edge_map(snapshot["edges"]).keys()
    for key, distance_km in _edge_map(preview["edges"]).items():
        assert distance_km == pytest.approx(_edge_map(snapshot["edges"])[key])


def test_result_of_an_unfinished_run_is_rejected(api: httpx2.Client) -> None:
    """Незавершённый запуск не отдаёт результат, чужой идентификатор даёт 404."""
    scenario = read_json(HIDDEN_SCENARIO)
    variant_id = create_project(api, scenario, "Незавершённый запуск")
    run = start_run(api, variant_id)

    response = api.get(f"/api/runs/{run['id']}/snapshot", params={"t_s": 0})
    if response.status_code == 400:
        assert response.json()["errors"][0]["code"] == "RUN_NOT_READY"
    else:
        # Расчёт успел закончиться раньше запроса: это не отменяет проверку кода ниже.
        assert response.status_code == 200, response.text
    await_success(api, str(run["id"]))

    unknown = api.get(f"/api/runs/{UNKNOWN_RUN_ID}/snapshot", params={"t_s": 0})
    assert unknown.status_code == 404, unknown.text
    assert unknown.json()["error"]["code"] == "NOT_FOUND"


def test_time_outside_the_grid_is_rejected(api: httpx2.Client) -> None:
    scenario = read_json(HIDDEN_SCENARIO)
    step_s = int(scenario["environment"]["step_s"])
    variant_id = create_project(api, scenario, "Отсчёт вне сетки")
    run = calculated_run(api, variant_id)

    response = api.get(f"/api/runs/{run['id']}/snapshot", params={"t_s": step_s + 1})

    assert response.status_code == 400, response.text
    error = response.json()["errors"][0]
    assert error["code"] == "INVALID_SCENARIO_FIELD"
    assert error["path"] == "t_s"


def test_unknown_client_of_backup_paths_is_not_found(api: httpx2.Client) -> None:
    scenario = read_json(HIDDEN_SCENARIO)
    variant_id = create_project(api, scenario, "Неизвестный пункт")
    run = calculated_run(api, variant_id)

    response = api.get(
        f"/api/runs/{run['id']}/backup-paths",
        params={"t_s": 0, "client_id": "нет-такого-пункта"},
    )

    assert response.status_code == 404, response.text
    error = response.json()["error"]
    assert error["code"] == "NOT_FOUND"
    assert error["path"] == "client_id"


def test_comparison_of_different_time_grids_is_rejected(api: httpx2.Client) -> None:
    """Запуски на разных сетках несравнимы: 400 с указанием поля сетки."""
    scenario = read_json(HIDDEN_SCENARIO)
    base_variant_id = create_project(api, scenario, "Сравнение сеток")
    base_run = calculated_run(api, base_variant_id)

    coarse = json.loads(json.dumps(scenario))
    coarse["environment"]["step_s"] = int(scenario["environment"]["step_s"]) * 2
    other_variant_id = create_project(api, coarse, "Сравнение сеток, другой шаг")
    other_run = calculated_run(api, other_variant_id)

    response = api.post(
        "/api/comparisons",
        json={"run_ids": [base_run["id"], other_run["id"]]},
    )

    assert response.status_code == 400, response.text
    error = response.json()["errors"][0]
    assert error["code"] == "INVALID_SCENARIO_FIELD"
    assert error["path"] == "environment.step_s"


def _edge_map(edges: list[dict[str, Any]]) -> dict[tuple[str, str, str], float]:
    return {(edge["a"], edge["b"], edge["kind"]): edge["distance_km"] for edge in edges}


def _export(api: httpx2.Client, run_id: str) -> dict[str, Any]:
    response = api.get(f"/api/runs/{run_id}/export")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert "attachment" in response.headers["content-disposition"]
    return dict(json.loads(response.text))


def _assert_snapshots_agree_with_edges(
    api: httpx2.Client,
    run_id: str,
    total_ticks: int,
    step_s: int,
    gateways: set[str],
) -> None:
    """Инварианты 1 и 2: рёбра маршрута есть в графе отсчёта, концы маршрута на местах."""
    for t_s in sample_ticks(total_ticks, step_s):
        snapshot = _json(api.get(f"/api/runs/{run_id}/snapshot", params={"t_s": t_s}))
        assert snapshot["t_s"] == t_s
        present = {frozenset((edge["a"], edge["b"])) for edge in snapshot["edges"]}
        satellites = {satellite["id"] for satellite in snapshot["satellites"]}
        for client in snapshot["clients"]:
            if not client["reachable"]:
                assert client["primary_cause"] is not None
                assert client["path"] == []
                continue
            path = client["path"]
            assert path[0] == client["client_id"]
            assert path[-1] in gateways
            assert client["hops"] == len(path) - 1
            assert set(path[1:-1]) <= satellites
            for first, second in pairwise(path):
                assert frozenset((first, second)) in present


def _assert_timeline_matches_metrics(
    api: httpx2.Client,
    run_id: str,
    metrics: dict[str, Any],
    total_ticks: int,
) -> None:
    timeline = _json(api.get(f"/api/runs/{run_id}/timeline"))
    assert timeline["total_ticks"] == total_ticks
    availability = {item["client_id"]: item["availability"] for item in metrics["clients"]}
    for item in timeline["clients"]:
        mask = unpack_bitset(item["availability_bitset"], total_ticks)
        assert int(mask.sum()) == round(availability[item["client_id"]] * total_ticks)
        visible = unpack_bitset(item["visibility_bitset"], total_ticks)
        # Инвариант 7 `10_FIXTURES.md` §2: маршрут невозможен без видимого аппарата.
        assert bool(np.all(visible | ~mask))
        assert len(item["causes"]) == total_ticks
        assert all(
            (cause is None) == bool(flag)
            for cause, flag in zip(item["causes"], mask, strict=True)
        )


def _assert_outages_fill_the_gap(
    api: httpx2.Client,
    run_id: str,
    availability: dict[str, float],
    horizon_s: int,
) -> None:
    """Инвариант 18: сумма перерывов клиента равна `(1 − availability) × horizon_s`."""
    outages = _json_list(api.get(f"/api/runs/{run_id}/outages"))
    counted = dict.fromkeys(availability, 0)
    for outage in outages:
        assert outage["duration_s"] == outage["end_s"] - outage["start_s"]
        assert outage["primary_cause"] in outage["causes"]
        counted[outage["client_id"]] += int(outage["duration_s"])
    for client_id, value in availability.items():
        assert counted[client_id] == pytest.approx((1.0 - value) * horizon_s, abs=1.0)


def _assert_backup_paths_exist_where_route_does(
    api: httpx2.Client,
    run_id: str,
    total_ticks: int,
    step_s: int,
) -> None:
    """Инвариант 19: там, где маршрут есть, независимых маршрутов не меньше одного."""
    for t_s in sample_ticks(total_ticks, step_s):
        snapshot = _json(api.get(f"/api/runs/{run_id}/snapshot", params={"t_s": t_s}))
        for client in snapshot["clients"]:
            backup = _json(
                api.get(
                    f"/api/runs/{run_id}/backup-paths",
                    params={"t_s": t_s, "client_id": client["client_id"]},
                ),
            )
            assert backup["t_s"] == t_s
            if client["reachable"]:
                assert backup["backup_path_count"] >= 1
                assert len(backup["paths"]) == backup["backup_path_count"]
            else:
                assert backup["backup_path_count"] == 0
                assert backup["paths"] == []
