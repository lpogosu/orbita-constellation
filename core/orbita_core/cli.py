"""Командная строка ядра: расчёт, golden-сверка, сверка с эталоном и валидация.

Только стандартная библиотека: ядро остаётся зависимым лишь от NumPy (`08_PLAN.md` §3),
а CLI — тонкой обёрткой над `engine`, `export` и `scenario`.

Таблицы печатаются в ASCII, а заголовки колонок совпадают с именами полей `05_API.md` §1.
Консоль Windows работает в cp866 или cp1251, и рамка из псевдографики Unicode в ней
рассыпалась бы; имена полей и так на английском (ADR-016).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Final

import numpy as np

from orbita_core import contacts, engine, export, geometry
from orbita_core.engine import RunResult
from orbita_core.metrics import ClientMetrics
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import Scenario, ScenarioError, load

# Корень репозитория: `orbita_core` лежит в `core/`, документы и эталон — рядом с ним.
REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES_PATH: Final[Path] = REPO_ROOT / "docs" / "10_FIXTURES.md"
DEFAULT_REFERENCE_PATH: Final[Path] = REPO_ROOT / "Расчетный модуль" / "geometry.py"

# Допуски golden-таблицы `10_FIXTURES.md` §1: доли, число переходов, точное совпадение
# наибольшего перерыва.
AVAILABILITY_TOLERANCE: Final[float] = 1e-4
MEAN_HOPS_TOLERANCE: Final[float] = 0.01
# Допуск сверки с официальным модулем: миллиметр на семи тысячах километров орбиты.
CROSSCHECK_TOLERANCE_KM: Final[float] = 1e-6

_TABLE_ROW = re.compile(r"^\|(?P<cells>.*)\|\s*$")
_SEPARATOR_ROW = re.compile(r"^[\s|:-]+$")


@dataclass(frozen=True, slots=True)
class GoldenRow:
    """Строка golden-таблицы `10_FIXTURES.md` §1.

    Единственный источник ожидаемых чисел — документ: копия значений в коде разошлась бы
    с ним незаметно.
    """

    scenario_stem: str
    client_id: str
    availability: float
    visibility: float
    max_gap_s: int
    mean_hops: float


def _number(cell: str) -> float:
    """Число из ячейки markdown: запятая как разделитель дроби, пробелы — разряды.

    Разряды в документе разделены неразрывным пробелом, и `\\s` в Python покрывает всю
    пробельную категорию Unicode: перечислять варианты пробела не нужно.
    """
    return float(re.sub(r"\s", "", cell).replace(",", "."))


def _table_cells(line: str) -> list[str] | None:
    match = _TABLE_ROW.match(line.rstrip())
    if match is None or _SEPARATOR_ROW.match(line.strip()):
        return None
    return [cell.strip().strip("`") for cell in match.group("cells").split("|")]


def golden_table(fixtures_path: Path = DEFAULT_FIXTURES_PATH) -> tuple[GoldenRow, ...]:
    """Разбирает golden-таблицу из `10_FIXTURES.md`.

    В документе имя сценария указано только в первой строке группы, дальше ячейка пустая:
    последнее непустое имя переносится на следующие строки.
    """
    rows: list[GoldenRow] = []
    scenario_stem = ""
    inside_section = False
    for line in fixtures_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            inside_section = line.startswith("## 1.")
            continue
        if not inside_section:
            continue
        cells = _table_cells(line)
        if cells is None or len(cells) != 6:
            continue
        if cells[0]:
            scenario_stem = cells[0]
        if not scenario_stem or not cells[1] or cells[1] == "Клиент":
            continue
        rows.append(
            GoldenRow(
                scenario_stem=scenario_stem,
                client_id=cells[1],
                availability=_number(cells[2]),
                visibility=_number(cells[3]),
                max_gap_s=int(_number(cells[4])),
                mean_hops=_number(cells[5]),
            )
        )
    if not rows:
        raise ValueError(f"в {fixtures_path} не найдена golden-таблица")
    return tuple(rows)


def _render_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    columns = [[header, *(row[index] for row in rows)] for index, header in enumerate(headers)]
    widths = [max(len(cell) for cell in column) for column in columns]
    border = "+" + "+".join("-" * (width + 2) for width in widths) + "+"

    def line(cells: Sequence[str]) -> str:
        return "| " + " | ".join(cell.ljust(widths[index]) for index, cell in enumerate(cells))

    body = [f"{line(row)} |" for row in rows]
    return "\n".join([border, f"{line(headers)} |", border, *body, border])


def _fraction(value: float) -> str:
    return f"{value:.4f}"


def _optional(value: float | int | None, digits: int) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def _client_rows(clients: Iterable[ClientMetrics]) -> list[list[str]]:
    return [
        [
            item.client_id,
            _fraction(item.availability),
            _fraction(item.visibility),
            str(item.max_gap_s),
            _optional(item.mean_hops, 2),
            _optional(item.max_hops, 0),
            str(item.route_switches),
            "yes" if item.target_met else "no",
        ]
        for item in clients
    ]


def _print_run_summary(result: RunResult) -> None:
    config = result.aggregate.config
    print(
        _render_table(
            [
                "client_id",
                "availability",
                "visibility",
                "max_gap_s",
                "mean_hops",
                "max_hops",
                "route_switches",
                "target_met",
            ],
            _client_rows(result.aggregate.clients),
        )
    )
    print()
    print(
        _render_table(
            ["metric", "value"],
            [
                ["min_client_availability", _fraction(config.min_client_availability)],
                ["mean_client_availability", _fraction(config.mean_client_availability)],
                ["worst_max_gap_s", str(config.worst_max_gap_s)],
                ["mean_hops", _optional(config.mean_hops, 3)],
                ["max_hops", _optional(config.max_hops, 0)],
                ["route_switches_total", str(config.route_switches_total)],
                ["backup_path_count_min", _optional(config.backup_path_count_min, 0)],
                ["target_met_clients", ", ".join(config.target_met_clients) or "-"],
                *(
                    [f"outage_count_by_cause.{cause}", str(count)]
                    for cause, count in config.outage_count_by_cause.items()
                ),
            ],
        )
    )
    print()
    print(f"engine_version: {result.engine_version}")
    print(f"routing_policy: {result.routing_policy}")
    print(f"config_hash:    {result.config_hash}")
    print(f"duration_ms:    {result.duration_ms}")


def _print_issues(error: ScenarioError) -> None:
    print(
        _render_table(
            ["code", "path", "message"],
            [[str(issue.code), issue.path or "-", issue.message] for issue in error.errors],
        )
    )


def command_run(arguments: argparse.Namespace) -> int:
    """Расчёт одного сценария: сводка метрик в консоль, полная выгрузка в файл."""
    try:
        scenario = load(arguments.scenario)
    except ScenarioError as error:
        _print_issues(error)
        return 1
    result = engine.run(
        scenario, RoutingPolicy(arguments.policy), backup_paths=arguments.backup_paths
    )
    _print_run_summary(result)
    if arguments.out is not None:
        export.dump_export(export.build_export(result), arguments.out)
        print(f"export:         {arguments.out}")
    return 0


def _golden_status(expected: float, actual: float, tolerance: float) -> bool:
    return abs(expected - actual) <= tolerance


def command_golden(arguments: argparse.Namespace) -> int:
    """Сверка расчёта с golden-таблицей документа на сценариях каталога.

    Каталог может содержать сценарии, которых в таблице нет (приёмочный сценарий со
    своими идентификаторами, ADR-015): такие файлы пропускаются молча, а вот строка
    таблицы без файла — повод для ненулевого кода возврата.
    """
    table = golden_table(arguments.fixtures)
    directory = Path(arguments.directory)
    rows: list[list[str]] = []
    failures = 0
    results: dict[str, RunResult] = {}
    for row in table:
        scenario_path = directory / f"{row.scenario_stem}.json"
        if not scenario_path.is_file():
            rows.append([row.scenario_stem, row.client_id, "-", "file not found", "FAIL"])
            failures += 1
            continue
        if row.scenario_stem not in results:
            results[row.scenario_stem] = engine.run(
                load(scenario_path), RoutingPolicy.BFS_SHORTEST, backup_paths=False
            )
        result = results[row.scenario_stem]
        found = {item.client_id: item for item in result.aggregate.clients}
        actual = found.get(row.client_id)
        if actual is None:
            rows.append([row.scenario_stem, row.client_id, "-", "client not found", "FAIL"])
            failures += 1
            continue
        checks: list[tuple[str, str, str, bool]] = [
            (
                "availability",
                _fraction(row.availability),
                _fraction(actual.availability),
                _golden_status(row.availability, actual.availability, AVAILABILITY_TOLERANCE),
            ),
            (
                "visibility",
                _fraction(row.visibility),
                _fraction(actual.visibility),
                _golden_status(row.visibility, actual.visibility, AVAILABILITY_TOLERANCE),
            ),
            (
                "max_gap_s",
                str(row.max_gap_s),
                str(actual.max_gap_s),
                row.max_gap_s == actual.max_gap_s,
            ),
            (
                "mean_hops",
                f"{row.mean_hops:.2f}",
                _optional(actual.mean_hops, 2),
                actual.mean_hops is not None
                and _golden_status(row.mean_hops, actual.mean_hops, MEAN_HOPS_TOLERANCE),
            ),
        ]
        for metric, expected_text, actual_text, passed in checks:
            rows.append(
                [
                    row.scenario_stem,
                    row.client_id,
                    metric,
                    f"{expected_text} / {actual_text}",
                    "ok" if passed else "FAIL",
                ]
            )
            failures += 0 if passed else 1
    print(_render_table(["scenario", "client_id", "metric", "expected / actual", "status"], rows))
    print()
    print(f"checks: {len(rows)}, failed: {failures}")
    return 1 if failures else 0


def _load_reference(path: Path) -> ModuleType:
    """Официальный `geometry.py` как модуль: он лежит вне пакета и вне `sys.path`."""
    spec = importlib.util.spec_from_file_location("orbita_reference_geometry", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"не удалось загрузить эталонный модуль: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _reference_edges(
    reference: ModuleType, raw: dict[str, object], t_s: int
) -> set[frozenset[str]]:
    snapshot = reference.snapshot(raw, float(t_s))
    return {frozenset((edge[0], edge[1])) for edge in snapshot["edges"]}


def _plan_edges(plan: contacts.ContactPlan, tick: int) -> set[frozenset[str]]:
    return {
        frozenset((plan.nodes[plan.edges[index, 0]], plan.nodes[plan.edges[index, 1]]))
        for index in plan.edges_at(tick)
    }


def _position_error_km(
    reference: ModuleType, raw: dict[str, object], scenario: Scenario, t_s: int
) -> float:
    reference_ids, _, reference_fixed = reference.positions(raw, float(t_s))
    expected = np.asarray(reference_fixed, dtype=np.float64)
    # Ядро сортирует аппараты по идентификатору, эталон сохраняет порядок файла.
    order = [scenario.satellite_index[satellite_id] for satellite_id in reference_ids]
    actual = geometry.positions_all(scenario)[t_s // scenario.environment.step_s][order]
    return float(np.max(np.abs(actual - expected)))


def command_crosscheck(arguments: argparse.Namespace) -> int:
    """Сверка позиций и состава рёбер с официальным расчётным модулем на отсчётах."""
    scenario_path = Path(arguments.scenario)
    try:
        scenario = load(scenario_path)
    except ScenarioError as error:
        _print_issues(error)
        return 1
    raw: dict[str, object] = json.loads(scenario_path.read_text(encoding="utf-8"))
    reference = _load_reference(Path(arguments.reference))
    plan = contacts.build(scenario)
    step_s = scenario.environment.step_s
    rows: list[list[str]] = []
    failures = 0
    for t_s in arguments.ticks:
        if t_s % step_s or not 0 <= t_s < scenario.environment.horizon_s:
            rows.append([str(t_s), "-", "-", "FAIL"])
            failures += 1
            continue
        position_error = _position_error_km(reference, raw, scenario, t_s)
        difference = _reference_edges(reference, raw, t_s) ^ _plan_edges(plan, t_s // step_s)
        passed = position_error < CROSSCHECK_TOLERANCE_KM and not difference
        failures += 0 if passed else 1
        rows.append(
            [str(t_s), f"{position_error:.3e}", str(len(difference)), "ok" if passed else "FAIL"]
        )
    headers = ["t_s", "max_position_error_km", "edge_symmetric_difference", "status"]
    print(_render_table(headers, rows))
    return 1 if failures else 0


def command_validate(arguments: argparse.Namespace) -> int:
    """Проверка сценария: список ошибок с кодами и путями до полей."""
    try:
        scenario = load(arguments.scenario)
    except ScenarioError as error:
        _print_issues(error)
        return 1
    print(
        f"ok: satellites {len(scenario.satellites)}, "
        f"ground sites {len(scenario.ground_sites)}, ticks {scenario.ticks}"
    )
    return 0


def _ticks(value: str) -> list[int]:
    return [int(part) for part in value.split(",") if part]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="orbita_core", description="Calculation core of ORBITA")
    commands = parser.add_subparsers(dest="command", required=True)

    run_parser = commands.add_parser("run", help="calculate one scenario")
    run_parser.add_argument("scenario", help="path to a cosmo-A-1.0 scenario")
    run_parser.add_argument(
        "--policy",
        choices=[str(policy) for policy in RoutingPolicy],
        default=str(RoutingPolicy.BFS_SHORTEST),
    )
    run_parser.add_argument("--out", help="path of the cosmo-A-result-1.0 export")
    run_parser.add_argument(
        "--no-backup-paths",
        dest="backup_paths",
        action="store_false",
        help="skip backup_path_count_min",
    )
    run_parser.set_defaults(handler=command_run, backup_paths=True)

    golden_parser = commands.add_parser("golden", help="compare with the documented values")
    golden_parser.add_argument("directory", help="directory with scenario files")
    golden_parser.add_argument(
        "--fixtures", type=Path, default=DEFAULT_FIXTURES_PATH, help="path to 10_FIXTURES.md"
    )
    golden_parser.set_defaults(handler=command_golden)

    crosscheck_parser = commands.add_parser("crosscheck", help="compare with the official module")
    crosscheck_parser.add_argument("scenario", help="path to a cosmo-A-1.0 scenario")
    crosscheck_parser.add_argument("--ticks", type=_ticks, required=True, help="times in seconds")
    crosscheck_parser.add_argument(
        "--reference", type=Path, default=DEFAULT_REFERENCE_PATH, help="path to geometry.py"
    )
    crosscheck_parser.set_defaults(handler=command_crosscheck)

    validate_parser = commands.add_parser("validate", help="validate a scenario file")
    validate_parser.add_argument("scenario", help="path to a cosmo-A-1.0 scenario")
    validate_parser.set_defaults(handler=command_validate)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Точка входа `python -m orbita_core`."""
    # Сообщения валидации на русском, а кодовая страница консоли Windows покрывает не весь
    # Unicode: подстановка вместо исключения не даёт команде упасть на печати отчёта.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    arguments = build_parser().parse_args(argv)
    started = time.perf_counter()
    handler: Callable[[argparse.Namespace], int] = arguments.handler
    code = handler(arguments)
    print(f"elapsed_ms:     {round((time.perf_counter() - started) * 1000)}")
    return code
