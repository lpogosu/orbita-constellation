"""Сверка расчёта с golden-значениями `10_FIXTURES.md` §1.

Ожидаемые числа и идентификаторы клиентов берутся из документа и файлов сценариев:
литералов в коде теста нет, иначе таблица и тест разошлись бы незаметно.
"""

from __future__ import annotations

import re
from functools import cache
from pathlib import Path
from typing import Final

import pytest

from orbita_core.cli import (
    AVAILABILITY_TOLERANCE,
    MEAN_HOPS_TOLERANCE,
    GoldenRow,
    golden_table,
    main,
)
from orbita_core.engine import RunResult, run
from orbita_core.metrics import ClientMetrics
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import load
from tests.support import FIXTURES_DOC_PATH, SCENARIOS_DIR

GOLDEN_ROWS: Final[tuple[GoldenRow, ...]] = golden_table(FIXTURES_DOC_PATH)

_DERIVED_BLOCK = re.compile(
    r"Производные значения для `(?P<stem>[^`]+)`:\s*"
    r"`min_client_availability = (?P<availability>[^`]+)`,\s*"
    r"`worst_max_gap_s = (?P<gap>[^`]+)`,\s*"
    r"`target_met_clients = \[(?P<clients>[^\]]+)\]`"
)


def _decimal(text: str) -> float:
    """Число документа: запятая как разделитель дроби, пробелы — разряды."""
    return float(re.sub(r"\s", "", text).replace(",", "."))


def _derived_values(path: Path) -> tuple[str, float, int, tuple[str, ...]]:
    """Производные значения конфигурации из текста `10_FIXTURES.md` §1."""
    match = _DERIVED_BLOCK.search(path.read_text(encoding="utf-8"))
    if match is None:
        raise ValueError(f"в {path} не найден блок производных значений")
    return (
        match.group("stem"),
        _decimal(match.group("availability")),
        int(_decimal(match.group("gap"))),
        tuple(client.strip() for client in match.group("clients").split(",")),
    )


@cache
def _result(scenario_stem: str) -> RunResult:
    """Расчёт сценария по `bfs_shortest`: условие golden-таблицы `10_FIXTURES.md` §1."""
    return run(load(SCENARIOS_DIR / f"{scenario_stem}.json"), RoutingPolicy.BFS_SHORTEST)


def _client(scenario_stem: str, client_id: str) -> ClientMetrics:
    found = {item.client_id: item for item in _result(scenario_stem).aggregate.clients}
    assert client_id in found, f"клиента {client_id} нет в сценарии {scenario_stem}"
    return found[client_id]


def _identify(row: GoldenRow) -> str:
    return f"{row.scenario_stem}-{row.client_id}"


def test_golden_table_covers_every_documented_row() -> None:
    """Таблица разобрана целиком: иначе тест молча проверял бы меньше, чем документ."""
    documented = sum(
        1
        for line in FIXTURES_DOC_PATH.read_text(encoding="utf-8").splitlines()
        if re.match(r"^\|\s*(`[^`]+`)?\s*\|\s*\w+\s*\|\s*\d", line)
    )
    assert len(GOLDEN_ROWS) == documented


@pytest.mark.parametrize("row", GOLDEN_ROWS, ids=_identify)
def test_golden_availability(row: GoldenRow) -> None:
    assert _client(row.scenario_stem, row.client_id).availability == pytest.approx(
        row.availability, abs=AVAILABILITY_TOLERANCE
    )


@pytest.mark.parametrize("row", GOLDEN_ROWS, ids=_identify)
def test_golden_visibility(row: GoldenRow) -> None:
    assert _client(row.scenario_stem, row.client_id).visibility == pytest.approx(
        row.visibility, abs=AVAILABILITY_TOLERANCE
    )


@pytest.mark.parametrize("row", GOLDEN_ROWS, ids=_identify)
def test_golden_max_gap_is_exact(row: GoldenRow) -> None:
    """Наибольший перерыв — целое число шагов сетки, допуска у него нет."""
    assert _client(row.scenario_stem, row.client_id).max_gap_s == row.max_gap_s


@pytest.mark.parametrize("row", GOLDEN_ROWS, ids=_identify)
def test_golden_mean_hops(row: GoldenRow) -> None:
    assert _client(row.scenario_stem, row.client_id).mean_hops == pytest.approx(
        row.mean_hops, abs=MEAN_HOPS_TOLERANCE
    )


def test_golden_derived_config_metrics() -> None:
    """Производные значения конфигурации из документа, включая список клиентов цели."""
    stem, availability, gap_s, documented_clients = _derived_values(FIXTURES_DOC_PATH)
    result = _result(stem)
    config = result.aggregate.config
    assert config.min_client_availability == pytest.approx(availability, abs=AVAILABILITY_TOLERANCE)
    assert config.worst_max_gap_s == gap_s
    # Документ перечисляет всех клиентов сценария: цель достигнута каждым из них.
    assert documented_clients == result.scenario.client_ids
    assert config.target_met_clients == result.scenario.client_ids


def test_cli_golden_command_returns_zero() -> None:
    """`python -m orbita_core golden ../scenarios` завершается без расхождений."""
    assert main(["golden", str(SCENARIOS_DIR), "--fixtures", str(FIXTURES_DOC_PATH)]) == 0
