"""OpenAPI как контракт: схема обязана совпадать с `docs/05_API.md`.

Список endpoint читается из документа, а не дублируется в тесте: иначе документ и код
расходятся молча, и фронтенд узнаёт об этом на интеграции.
"""

import re
from pathlib import Path
from typing import Any, Final

import pytest
from fastapi.testclient import TestClient

from contract_data import MINIMAL_SCENARIO, OTHER_UUID, SAMPLE_UUID
from orbita_api.main import create_app

API_DOC_RELATIVE_PATH: Final[Path] = Path("docs") / "05_API.md"
ENDPOINT_MAP_HEADING: Final[str] = "## 2. Endpoint map"

# Строка таблицы: | `METHOD` | `/api/...` | назначение |
_TABLE_ROW: Final[re.Pattern[str]] = re.compile(
    r"^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`(/api/[^`]+)`\s*\|",
)

# В документе параметр пути называется `{id}`: имя берётся из предыдущего сегмента.
_ID_BY_COLLECTION: Final[dict[str, str]] = {
    "projects": "project_id",
    "variants": "variant_id",
    "runs": "run_id",
    "experiments": "experiment_id",
}

# Сущности `05_API.md` §1: их имена видит фронтенд, переименование ломает клиент.
ENTITY_SCHEMAS: Final[tuple[str, ...]] = (
    "Project",
    "Variant",
    "Run",
    "Snapshot",
    "OutageInterval",
    "ClientMetrics",
    "ConfigMetrics",
    "Recommendation",
)

SERVICE_ENDPOINTS: Final[frozenset[tuple[str, str]]] = frozenset(
    {("get", "/api/health"), ("get", "/api/version")},
)

# Endpoint с реализацией: они ходят в Postgres и проверяются интеграционными тестами
# (`tests/test_projects.py`, `tests/test_runs.py`). Список сокращается по мере того, как
# заглушки исчезают, и вместе с последней исчезнет сам тест про 501.
IMPLEMENTED_ENDPOINTS: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("post", "/api/scenarios/validate"),
        ("post", "/api/projects"),
        ("get", "/api/projects"),
        ("get", "/api/projects/{project_id}"),
        ("post", "/api/projects/{project_id}/variants"),
        ("get", "/api/projects/{project_id}/lineage"),
        ("get", "/api/variants/{variant_id}"),
        ("get", "/api/variants/{variant_id}/export"),
        ("post", "/api/runs"),
        ("get", "/api/runs/{run_id}"),
        ("get", "/api/runs/{run_id}/events"),
        ("post", "/api/runs/{run_id}/cancel"),
        ("post", "/api/preview"),
        ("get", "/api/runs/{run_id}/snapshot"),
        ("get", "/api/runs/{run_id}/timeline"),
        ("get", "/api/runs/{run_id}/metrics"),
        ("get", "/api/runs/{run_id}/outages"),
        ("get", "/api/runs/{run_id}/backup-paths"),
        ("get", "/api/runs/{run_id}/export"),
        ("get", "/api/runs/{run_id}/evidence-pack"),
        ("post", "/api/comparisons"),
        ("get", "/api/runs/{run_id}/recommendation"),
        ("post", "/api/analysis/criticality"),
        ("post", "/api/experiments"),
        ("get", "/api/experiments/{experiment_id}"),
        ("get", "/api/experiments/{experiment_id}/points"),
        ("post", "/api/experiments/{experiment_id}/points/{point_id}/materialize"),
    },
)

# Тела корректных запросов: заглушка обязана отвечать 501, а не 400 на разбор входа.
REQUEST_BODIES: Final[dict[tuple[str, str], dict[str, Any]]] = {
    ("post", "/api/scenarios/validate"): MINIMAL_SCENARIO,
    ("post", "/api/projects"): {"title": "Проект", "scenario": MINIMAL_SCENARIO},
    ("post", "/api/projects/{project_id}/variants"): {
        "title": "Вариант",
        "scenario": MINIMAL_SCENARIO,
    },
    ("post", "/api/preview"): {"scenario": MINIMAL_SCENARIO, "t_s": 0},
    ("post", "/api/runs"): {"variant_id": SAMPLE_UUID, "routing_policy": "bfs_shortest"},
    ("post", "/api/comparisons"): {"run_ids": [SAMPLE_UUID, OTHER_UUID]},
    ("post", "/api/experiments"): {
        "variant_id": SAMPLE_UUID,
        "axes": [{"path": "design.planes[0].raan_deg", "from": 0, "to": 90, "step": 15}],
        "budget": {"max_points": 10, "max_seconds": 60},
    },
    ("post", "/api/experiments/{experiment_id}/points/{point_id}/materialize"): {
        "title": "Лучшая точка",
    },
    ("post", "/api/analysis/criticality"): {"run_id": SAMPLE_UUID},
}

QUERY_STRINGS: Final[dict[str, str]] = {
    "/api/runs/{run_id}/snapshot": "?t_s=0",
    "/api/runs/{run_id}/backup-paths": "?t_s=0&client_id=CL1",
    "/api/runs/{run_id}/recommendation": f"?base_run_id={OTHER_UUID}",
}

_PATH_PARAMETER: Final[re.Pattern[str]] = re.compile(r"\{[a-z_]+\}")


def find_api_doc() -> Path:
    """Ищет `docs/05_API.md` вверх от тестов: путь одинаков и локально, и в образе."""
    for directory in Path(__file__).resolve().parents:
        candidate = directory / API_DOC_RELATIVE_PATH
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"{API_DOC_RELATIVE_PATH} не найден рядом с тестами")


def name_path_parameters(path: str) -> str:
    """`/api/runs/{id}/metrics` -> `/api/runs/{run_id}/metrics`."""
    segments = path.split("/")
    for index, segment in enumerate(segments):
        if segment == "{id}":
            segments[index] = "{" + _ID_BY_COLLECTION[segments[index - 1]] + "}"
    return "/".join(segments)


def documented_endpoints() -> set[tuple[str, str]]:
    """Пары «метод, путь» из раздела «Endpoint map» документа."""
    lines = find_api_doc().read_text(encoding="utf-8").splitlines()
    start = lines.index(ENDPOINT_MAP_HEADING) + 1
    endpoints: set[tuple[str, str]] = set()
    for line in lines[start:]:
        if line.startswith("## "):
            break
        match = _TABLE_ROW.match(line)
        if match is None:
            continue
        method, path = match.groups()
        # В документе у части путей показаны параметры запроса: `?t_s=`.
        endpoints.add((method.lower(), name_path_parameters(path.split("?")[0])))
    return endpoints


def openapi_endpoints(schema: dict[str, Any]) -> set[tuple[str, str]]:
    return {(method, path) for path, operations in schema["paths"].items() for method in operations}


def concrete_url(path: str) -> str:
    return _PATH_PARAMETER.sub(SAMPLE_UUID, path) + QUERY_STRINGS.get(path, "")


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture(scope="module")
def schema(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    return dict(response.json())


def test_openapi_paths_match_the_document(schema: dict[str, Any]) -> None:
    assert openapi_endpoints(schema) == documented_endpoints()


def test_criticality_lifecycle_routes_stay_internal(schema: dict[str, Any]) -> None:
    """Polling/cancel helpers are implementation details, not public API promises."""
    paths = schema["paths"]
    assert "/api/analysis/criticality/{run_id}/status" not in paths
    assert "/api/analysis/criticality/{run_id}/cancel" not in paths


def test_document_lists_every_endpoint_group() -> None:
    """Страховка от пустого разбора: молча пройденный тест хуже упавшего."""
    endpoints = documented_endpoints()

    assert len(endpoints) == 29
    assert ("post", "/api/runs") in endpoints
    assert ("get", "/api/runs/{run_id}/snapshot") in endpoints


@pytest.mark.parametrize("name", ENTITY_SCHEMAS)
def test_entity_schemas_are_published(schema: dict[str, Any], name: str) -> None:
    assert name in schema["components"]["schemas"]


@pytest.mark.parametrize("enum_name", ["RoutingPolicy", "RunStatus", "RunStage", "OutageCause"])
def test_enum_values_come_from_the_glossary(schema: dict[str, Any], enum_name: str) -> None:
    expected = {
        "RoutingPolicy": ["bfs_shortest", "persistent", "dijkstra_distance"],
        "RunStatus": ["queued", "running", "succeeded", "failed", "cancelled"],
        "RunStage": [
            "validate",
            "geometry",
            "contacts",
            "routing",
            "analytics",
            "persist",
            "complete",
        ],
        "OutageCause": [
            "NO_CLIENT_COVERAGE",
            "GATEWAY_OUTAGE",
            "NO_GATEWAY_COVERAGE",
            "NETWORK_PARTITION",
            "INTERNAL_INCONSISTENCY",
        ],
    }[enum_name]

    assert schema["components"]["schemas"][enum_name]["enum"] == expected


def test_scenario_schema_keeps_field_names_of_the_case(schema: dict[str, Any]) -> None:
    """Имена разделов сценария `cosmo-A-1.0` менять нельзя: их задаёт кейс."""
    scenario = schema["components"]["schemas"]["Scenario"]

    assert set(scenario["properties"]) == {
        "schema_version",
        "meta",
        "environment",
        "design",
        "ground_sites",
        "failures",
        "gateway_outages",
    }


def test_parameter_change_uses_reserved_word_from(schema: dict[str, Any]) -> None:
    """`from` - ключевое слово Python, но в JSON поле называется так же, как в контракте."""
    assert set(schema["components"]["schemas"]["ParameterChange"]["properties"]) == {
        "path",
        "from",
        "to",
    }


def test_no_endpoint_promises_the_default_validation_response(schema: dict[str, Any]) -> None:
    """Ошибки входа - 400: автоматический 422 от FastAPI в схеме остаться не должен."""
    with_422 = {
        (method, path)
        for path, operations in schema["paths"].items()
        for method, operation in operations.items()
        if "422" in operation["responses"]
    }

    assert with_422 == {("post", "/api/experiments")}


@pytest.mark.parametrize(
    ("method", "path"),
    sorted(documented_endpoints() - SERVICE_ENDPOINTS - IMPLEMENTED_ENDPOINTS),
)
def test_every_declared_endpoint_answers_not_implemented(
    client: TestClient,
    method: str,
    path: str,
) -> None:
    """Скелет отвечает 501 на корректный запрос, а не 404 и не 400."""
    response = client.request(
        method.upper(),
        concrete_url(path),
        json=REQUEST_BODIES.get((method, path)),
    )

    assert response.status_code == 501, response.text
    assert response.json()["error"]["code"] == "NOT_IMPLEMENTED"
