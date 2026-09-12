"""Перевод результата ядра в строки Postgres: ничего не теряется и не переименовывается.

База здесь не нужна: проверяются объекты строк, а не запись. Сценарий берётся из
репозитория, ожидаемые значения считает то же ядро (ADR-015).
"""

import json
from pathlib import Path
from typing import Any, Final
from uuid import uuid4

from orbita_core import engine
from orbita_core.metrics import AggregateResult
from orbita_core.routing import RoutingPolicy

from orbita_worker import persistence

SCENARIO_RELATIVE_PATH: Final[str] = "scenarios/02_first_launch.json"

EVIDENCE_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "client_visible_satellites",
        "gateway_visible_satellites",
        "failed_satellites",
        "client_component_id",
        "gateway_component_id",
        "last_path",
        "next_path",
    },
)


def load_aggregate() -> AggregateResult:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / SCENARIO_RELATIVE_PATH
        if candidate.is_file():
            scenario: dict[str, Any] = json.loads(candidate.read_text(encoding="utf-8"))
            return engine.run(scenario, RoutingPolicy.BFS_SHORTEST).aggregate
    raise FileNotFoundError(f"{SCENARIO_RELATIVE_PATH} не найден рядом с тестами")


def test_every_client_and_outage_becomes_a_row() -> None:
    run_id = uuid4()
    aggregate = load_aggregate()

    clients = persistence.client_metric_rows(run_id, aggregate)
    outages = persistence.outage_rows(run_id, aggregate)
    config = persistence.config_metric_row(run_id, aggregate)

    assert [row.client_id for row in clients] == [
        metrics.client_id for metrics in aggregate.clients
    ]
    assert all(row.run_id == run_id for row in clients)
    assert len(outages) == len(aggregate.outages)
    assert config.run_id == run_id
    assert config.worst_max_gap_s == aggregate.config.worst_max_gap_s


def test_outage_row_keeps_evidence_of_the_cause() -> None:
    """Причина без доказательств бесполезна: экран показывает именно эти поля (ADR-005)."""
    aggregate = load_aggregate()
    assert aggregate.outages, "сценарий без перерывов не проверяет перевод доказательств"

    row = persistence.outage_rows(uuid4(), aggregate)[0]
    source = aggregate.outages[0]

    assert str(row.primary_cause) == str(source.primary_cause)
    assert row.causes == [str(cause) for cause in source.causes]
    assert set(row.evidence) == EVIDENCE_FIELDS
    # Маршрута до начала горизонта может не быть: контракт ждёт список, а не null.
    assert isinstance(row.evidence["last_path"], list)


def test_counts_by_cause_use_glossary_names() -> None:
    """В JSONB уходят строки глоссария: по ним считает фронтенд и запросы аналитики."""
    aggregate = load_aggregate()

    row = persistence.client_metric_rows(uuid4(), aggregate)[0]
    expected = aggregate.clients[0].outage_count_by_cause

    assert row.outage_count_by_cause == {str(cause): count for cause, count in expected.items()}
    assert all(key.isupper() for key in row.outage_count_by_cause)
