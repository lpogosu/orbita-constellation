"""Конверт ошибок входа: код, путь до поля и полный список (`05_API.md` §3).

Живых хранилищ тесты не требуют: ошибка входа обнаруживается до обращения к базе.
Приложение всё же поднимается через `with`, потому что обработчики зависят от клиентов,
созданных в lifespan; сетевых соединений при этом никто не открывает.
"""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from contract_data import MINIMAL_SCENARIO, SAMPLE_UUID
from orbita_api.error_handling import (
    EndpointNotImplementedError,
    json_path,
    register_error_handlers,
)
from orbita_api.main import create_app


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def test_unknown_routing_policy_names_the_field(client: TestClient) -> None:
    response = client.post(
        "/api/runs",
        json={"variant_id": SAMPLE_UUID, "routing_policy": "fastest"},
    )

    assert response.status_code == 400
    errors = response.json()["errors"]
    assert len(errors) == 1
    assert errors[0]["code"] == "INVALID_SCENARIO_FIELD"
    assert errors[0]["path"] == "routing_policy"
    assert errors[0]["details"]["value"] == "fastest"


def test_missing_field_uses_the_same_code(client: TestClient) -> None:
    """Отсутствие обязательного поля - та же ошибка входа, что и неверное значение."""
    response = client.post("/api/runs", json={"routing_policy": "bfs_shortest"})

    assert response.status_code == 400
    errors = response.json()["errors"]
    assert errors[0]["code"] == "INVALID_SCENARIO_FIELD"
    assert errors[0]["path"] == "variant_id"


def test_every_error_is_reported_at_once(client: TestClient) -> None:
    """Инженер исправляет файл за один проход, поэтому список ошибок полный."""
    scenario: dict[str, Any] = {
        **MINIMAL_SCENARIO,
        "design": {
            **MINIMAL_SCENARIO["design"],
            "planes": [
                {"id": "PA", "raan_deg": 0.0, "phase_deg": 0.0},
                {"id": "PB", "raan_deg": "восток", "phase_deg": None},
            ],
        },
    }

    response = client.post("/api/scenarios/validate", json=scenario)

    assert response.status_code == 400
    paths = [error["path"] for error in response.json()["errors"]]
    assert paths == ["design.planes[1].raan_deg", "design.planes[1].phase_deg"]


def test_query_parameter_error_names_the_parameter(client: TestClient) -> None:
    response = client.get(f"/api/runs/{SAMPLE_UUID}/snapshot?t_s=-1")

    assert response.status_code == 400
    assert response.json()["errors"][0]["path"] == "t_s"


def test_not_implemented_envelope_has_no_field_path() -> None:
    """Заглушка сообщает о самом endpoint, поэтому поля с ошибкой у неё нет.

    Все объявленные endpoint уже реализованы, а 501 остаётся в контракте, поэтому
    заглушка ставится на отдельное приложение с теми же обработчиками ошибок.
    """
    endpoint = f"/api/stub/{SAMPLE_UUID}"
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/api/stub/{item_id}")
    async def stub(item_id: str) -> None:
        raise EndpointNotImplementedError

    response = TestClient(app).get(endpoint)

    assert response.status_code == 501
    error = response.json()["error"]
    assert error["code"] == "NOT_IMPLEMENTED"
    assert error["path"] is None
    assert error["details"] == {"method": "GET", "endpoint": endpoint}


@pytest.mark.parametrize(
    ("loc", "expected"),
    [
        (("body", "routing_policy"), "routing_policy"),
        (("body", "design", "planes", 1, "raan_deg"), "design.planes[1].raan_deg"),
        (("query", "t_s"), "t_s"),
        (("body", 0, "id"), "[0].id"),
        (("body",), None),
    ],
)
def test_json_path_uses_dotted_notation(
    loc: tuple[int | str, ...],
    expected: str | None,
) -> None:
    assert json_path(loc) == expected
