"""Outage Detective на живом стеке: расчёт до отказа против расчёта после него.

Пара берётся из каталога сценариев: второй файл — тот же проект с добавленными отказами
аппаратов, поэтому оба варианта живут в одном проекте и различаются только полем
`failures`. Это ровно тот случай, который разбирает экран «Отказы» (`14_SCREENS.md` §3).

Адрес берётся из `ORBITA_TEST_API_URL` (по умолчанию `http://localhost:8000`). Без
отвечающего api тесты помечаются `skip`: образ проверок собирается без поднятого стека.

Ни одного идентификатора из сценариев в коде: клиенты, отказавшие аппараты и границы
отказа читаются из самих файлов и ответов.
"""

from __future__ import annotations

import base64
import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Final

import httpx2
import numpy as np
import pytest

from conftest import read_json
from orbita_api.schemas.common import OutageCause, OutageChangeKind

API_URL_ENV: Final[str] = "ORBITA_TEST_API_URL"
DEFAULT_API_URL: Final[str] = "http://localhost:8000"

# Два варианта одной задачи: без отказов и с отказами аппаратов.
BASE_SCENARIO: Final[str] = "scenarios/01_full_constellation.json"
FAILURE_SCENARIO: Final[str] = "scenarios/03_satellite_outages.json"

RUN_TIMEOUT_S: Final[float] = 120.0
POLL_STEP_S: Final[float] = 0.2
REQUEST_TIMEOUT_S: Final[float] = 60.0

# Виды изменений, при которых картина перерывов у клиента перестала быть прежней.
RESHAPING_KINDS: Final[frozenset[str]] = frozenset(
    {str(OutageChangeKind.ADDED), str(OutageChangeKind.CHANGED)},
)
KNOWN_CAUSES: Final[frozenset[str]] = frozenset(str(cause) for cause in OutageCause)


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
    """Тело успешного ответа; неуспешный печатается целиком в сообщении об ошибке."""
    assert response.status_code < 400, f"{response.status_code}: {response.text}"
    return dict(response.json())


def create_project(api: httpx2.Client, scenario: dict[str, Any], title: str) -> str:
    project = _json(api.post("/api/projects", json={"title": title, "scenario": scenario}))
    assert project["active_variant_id"] is not None
    return str(project["active_variant_id"])


def add_variant(
    api: httpx2.Client,
    parent_variant_id: str,
    scenario: dict[str, Any],
    title: str,
) -> str:
    """Второй вариант того же проекта: сравнивать имеет смысл соседей по проекту."""
    project_id = _json(api.get(f"/api/variants/{parent_variant_id}"))["project_id"]
    variant = _json(
        api.post(
            f"/api/projects/{project_id}/variants",
            json={"title": title, "scenario": scenario},
        ),
    )
    return str(variant["id"])


def start_run(api: httpx2.Client, variant_id: str) -> str:
    response = api.post("/api/runs", json={"variant_id": variant_id})
    assert response.status_code in {200, 202}, response.text
    return str(response.json()["id"])


def await_success(api: httpx2.Client, run_id: str) -> None:
    deadline = time.monotonic() + RUN_TIMEOUT_S
    state: dict[str, Any] = {}
    while time.monotonic() < deadline:
        state = _json(api.get(f"/api/runs/{run_id}"))
        if state["status"] == "succeeded":
            return
        assert state["status"] in {"queued", "running"}, state
        time.sleep(POLL_STEP_S)
    raise AssertionError(f"Расчёт {run_id} не завершился за {RUN_TIMEOUT_S} с: {state}")


def calculated_run(api: httpx2.Client, variant_id: str) -> str:
    run_id = start_run(api, variant_id)
    await_success(api, run_id)
    return run_id


def compare(api: httpx2.Client, run_ids: list[str]) -> dict[str, Any]:
    return _json(api.post("/api/comparisons", json={"run_ids": run_ids}))


def availability_bitsets(
    api: httpx2.Client,
    run_id: str,
) -> dict[str, np.ndarray]:
    """Маски доступности клиентов из шкалы времени: независимый источник тех же фактов."""
    timeline = _json(api.get(f"/api/runs/{run_id}/timeline"))
    total_ticks = int(timeline["total_ticks"])
    return {
        client["client_id"]: np.unpackbits(
            np.frombuffer(base64.b64decode(client["availability_bitset"]), dtype=np.uint8),
        )[:total_ticks].astype(bool)
        for client in timeline["clients"]
    }


@dataclass(frozen=True)
class OutageCase:
    """Пара расчётов одного проекта и их сравнение в обе стороны."""

    base_run_id: str
    failed_run_id: str
    forward: dict[str, Any]
    backward: dict[str, Any]
    step_s: int
    total_ticks: int
    first_failure_s: int


@pytest.fixture(scope="session")
def case(api: httpx2.Client) -> OutageCase:
    base_scenario = read_json(BASE_SCENARIO)
    failed_scenario = read_json(FAILURE_SCENARIO)
    environment = base_scenario["environment"]
    step_s = int(environment["step_s"])

    base_variant_id = create_project(api, base_scenario, "Разбор отказа: база")
    failed_variant_id = add_variant(
        api,
        base_variant_id,
        failed_scenario,
        "Разбор отказа: отказы аппаратов",
    )
    base_run_id = calculated_run(api, base_variant_id)
    failed_run_id = calculated_run(api, failed_variant_id)

    return OutageCase(
        base_run_id=base_run_id,
        failed_run_id=failed_run_id,
        forward=compare(api, [base_run_id, failed_run_id]),
        backward=compare(api, [failed_run_id, base_run_id]),
        step_s=step_s,
        total_ticks=int(environment["horizon_s"]) // step_s,
        first_failure_s=min(int(item["start_s"]) for item in failed_scenario["failures"]),
    )


def other_entry(comparison: dict[str, Any]) -> dict[str, Any]:
    """Запись сравниваемого запуска: базовая идёт первой и дельт не несёт."""
    base, other = comparison["entries"]
    assert base["per_client"] == []
    assert base["affected_clients"] == []
    assert base["first_divergence_t_s"] is None
    return dict(other)


def test_failure_creates_new_outages_with_evidence(case: OutageCase) -> None:
    """У затронутых клиентов появились перерывы с причиной и отказавшими аппаратами."""
    entry = other_entry(case.forward)
    assert entry["affected_clients"]

    per_client = {item["client_id"]: item for item in entry["per_client"]}
    for client_id in entry["affected_clients"]:
        added = [
            change
            for change in per_client[client_id]["outage_diff"]
            if change["kind"] == str(OutageChangeKind.ADDED)
        ]
        assert added, f"клиент {client_id} затронут, но новых перерывов нет"
        for change in added:
            assert change["base_start_s"] is None
            assert change["other_start_s"] < change["other_end_s"]
            assert change["primary_cause"] in KNOWN_CAUSES
            assert set(change["causes"]) <= KNOWN_CAUSES
            # Перерыв, которого не было до отказа, начинается уже внутри окна отказа,
            # поэтому в доказательствах обязаны стоять недоступные аппараты.
            assert change["failed_satellites"]


def test_affected_flag_follows_added_changed_and_availability(case: OutageCase) -> None:
    """`affected` — это появившийся или изменившийся перерыв либо падение доступности."""
    entry = other_entry(case.forward)

    for item in entry["per_client"]:
        kinds = {change["kind"] for change in item["outage_diff"]}
        expected = bool(kinds & RESHAPING_KINDS) or item["availability_delta"] < 0
        assert item["affected"] is expected, item["client_id"]
    assert entry["affected_clients"] == [
        item["client_id"] for item in entry["per_client"] if item["affected"]
    ]


def test_divergence_starts_no_earlier_than_the_failure(case: OutageCase) -> None:
    """До первого отказа оба расчёта совпадают: расходиться раньше им не с чего."""
    entry = other_entry(case.forward)

    assert entry["first_divergence_t_s"] is not None
    assert entry["first_divergence_t_s"] >= case.first_failure_s
    for item in entry["per_client"]:
        if item["first_divergence_t_s"] is not None:
            assert item["first_divergence_t_s"] >= case.first_failure_s
        if item["first_new_outage_t_s"] is not None:
            assert item["first_new_outage_t_s"] >= entry["first_divergence_t_s"]


def test_first_new_outage_matches_the_timelines(api: httpx2.Client, case: OutageCase) -> None:
    """Первый новый перерыв совпадает с первым отсчётом, потерянным на шкале времени."""
    before = availability_bitsets(api, case.base_run_id)
    after = availability_bitsets(api, case.failed_run_id)
    entry = other_entry(case.forward)

    for item in entry["per_client"]:
        lost = np.flatnonzero(before[item["client_id"]] & ~after[item["client_id"]])
        expected = int(lost[0]) * case.step_s if lost.size else None
        assert item["first_new_outage_t_s"] == expected


def test_kept_and_rebuilt_ticks_split_the_common_route_ticks(
    api: httpx2.Client,
    case: OutageCase,
) -> None:
    """Отсчёты с маршрутом в обоих расчётах делятся на сохранённые и перестроенные."""
    before = availability_bitsets(api, case.base_run_id)
    after = availability_bitsets(api, case.failed_run_id)
    entry = other_entry(case.forward)

    for item in entry["per_client"]:
        common = int((before[item["client_id"]] & after[item["client_id"]]).sum())
        assert item["route_kept_ticks"] + item["route_rebuilt_ticks"] == common
        assert item["route_kept_ticks"] <= case.total_ticks


def test_removing_the_failure_creates_no_new_outages(case: OutageCase) -> None:
    """Обратная сторона сравнения: снятие отказа не рождает перерывов.

    Отказ убирает линии связи и не может добавить маршрут, поэтому обратное сравнение
    обязано состоять из исчезнувших и сжавшихся перерывов (инвариант 8 `10_FIXTURES.md`
    §2). Затронутым клиент при этом остаётся: его картина перерывов изменилась.
    """
    entry = other_entry(case.backward)

    for item in entry["per_client"]:
        kinds = {change["kind"] for change in item["outage_diff"]}
        assert str(OutageChangeKind.ADDED) not in kinds
        assert item["first_new_outage_t_s"] is None
        assert item["availability_delta"] >= 0


def test_comparison_of_different_time_grids_is_rejected(api: httpx2.Client) -> None:
    """Запуски на разных сетках несравнимы: 400 с указанием поля шага."""
    scenario = read_json(BASE_SCENARIO)
    base_run_id = calculated_run(api, create_project(api, scenario, "Сетки: шаг по умолчанию"))

    coarse = json.loads(json.dumps(scenario))
    coarse["environment"]["step_s"] = int(scenario["environment"]["step_s"]) * 2
    coarse_run_id = calculated_run(api, create_project(api, coarse, "Сетки: удвоенный шаг"))

    response = api.post(
        "/api/comparisons",
        json={"run_ids": [base_run_id, coarse_run_id]},
    )

    assert response.status_code == 400, response.text
    error = response.json()["errors"][0]
    assert error["code"] == "INVALID_SCENARIO_FIELD"
    assert error["path"] == "environment.step_s"


def test_comparison_of_an_unfinished_run_is_rejected(api: httpx2.Client, case: OutageCase) -> None:
    """Незавершённый запуск сравнивать нечем: результата ещё нет."""
    scenario = read_json(BASE_SCENARIO)
    # Своя конфигурация на той же сетке: иначе готовый расчёт переиспользуется по
    # config_hash и сравнивать было бы нечего (ADR-011).
    shifted = json.loads(json.dumps(scenario))
    plane = shifted["design"]["planes"][-1]
    plane["raan_deg"] = (float(plane["raan_deg"]) + 7.0) % 360.0
    variant_id = create_project(api, shifted, "Незавершённый запуск в сравнении")
    fresh_run_id = start_run(api, variant_id)

    response = api.post(
        "/api/comparisons",
        json={"run_ids": [case.base_run_id, fresh_run_id]},
    )

    if response.status_code == 400:
        assert response.json()["errors"][0]["code"] == "RUN_NOT_READY"
    else:
        # Расчёт успел закончиться раньше запроса: сравнение тогда обязано состояться.
        assert response.status_code == 200, response.text
    await_success(api, fresh_run_id)
