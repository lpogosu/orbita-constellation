"""Выгрузка результата в формате `cosmo-A-result-1.0` (`01_SPEC.md` §8, `05_API.md` §5).

Экспорт обязан быть детерминированным: две одинаковые конфигурации дают байт в байт
одинаковый файл (инвариант 10 `10_FIXTURES.md` §2). Поэтому порядок ключей задан явно
списками полей, а не сортировкой: сортировка ключей ломает читаемость файла, который
открывают глазами, а полагаться на порядок вставки в словарь — значит связать формат
выгрузки с порядком строк в коде.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from orbita_core.diagnosis import OutageCause
from orbita_core.engine import RunResult
from orbita_core.metrics import ClientMetrics, ConfigMetrics, OutageInterval
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import Scenario, ScenarioError, ScenarioIssue, parse, to_dict

EXPORT_SCHEMA_VERSION: Final[str] = "cosmo-A-result-1.0"


class ExportError(ValueError):
    """Файл выгрузки не соответствует формату `cosmo-A-result-1.0`.

    Отдельное исключение, а не `ScenarioError`: коды `ErrorCode` описывают ошибки
    сценария на входе API, а здесь бракуется сам файл результата. Ошибки вложенного
    `effective_scenario` по-прежнему приходят как `ScenarioError` со своими кодами.
    """

    def __init__(self, message: str, *, path: str) -> None:
        super().__init__(message)
        self.path = path


@dataclass(frozen=True, slots=True)
class ExportRoute:
    """Одна запись `routes`: маршрут клиента на отсчёте, пустой путь — маршрута нет."""

    t_s: int
    client_id: str
    path: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class LoadedExport:
    """Разобранный файл выгрузки.

    `scenario` уже канонизирован и пригоден для повторной подачи в `engine.run`: именно
    так проверяется, что выгрузка замкнута сама на себя (инвариант 10).
    """

    schema_version: str
    run_id: str | None
    engine_version: str
    routing_policy: RoutingPolicy
    config_hash: str
    scenario: Scenario
    routes: tuple[ExportRoute, ...]


def _counts_by_cause(counts: Mapping[OutageCause, int]) -> dict[str, int]:
    """Счётчики причин в порядке таблицы `03_GLOSSARY.md` §3.1.

    Порядок обхода исходного словаря зависит от того, какая причина встретилась первой, —
    для байт-в-байт одинакового файла этого достаточно, но читать выгрузки двух вариантов
    рядом удобнее, когда причины всегда идут в одном порядке.
    """
    return {str(cause): counts[cause] for cause in OutageCause if cause in counts}


def _client_metrics(item: ClientMetrics) -> dict[str, object]:
    return {
        "client_id": item.client_id,
        "availability": item.availability,
        "visibility": item.visibility,
        "max_gap_s": item.max_gap_s,
        "mean_hops": item.mean_hops,
        "max_hops": item.max_hops,
        "route_switches": item.route_switches,
        "target_met": item.target_met,
        "outage_count_by_cause": _counts_by_cause(item.outage_count_by_cause),
    }


def _config_metrics(item: ConfigMetrics) -> dict[str, object]:
    return {
        "min_client_availability": item.min_client_availability,
        "mean_client_availability": item.mean_client_availability,
        "worst_max_gap_s": item.worst_max_gap_s,
        "mean_hops": item.mean_hops,
        "max_hops": item.max_hops,
        "route_switches_total": item.route_switches_total,
        "backup_path_count_min": item.backup_path_count_min,
        "outage_count_by_cause": _counts_by_cause(item.outage_count_by_cause),
        "target_met_clients": list(item.target_met_clients),
    }


def _outage(item: OutageInterval) -> dict[str, object]:
    return {
        "client_id": item.client_id,
        "start_s": item.start_s,
        "end_s": item.end_s,
        "duration_s": item.duration_s,
        "truncated_by_horizon": item.truncated_by_horizon,
        "primary_cause": str(item.primary_cause),
        "causes": [str(cause) for cause in item.causes],
        "client_visible_satellites": list(item.client_visible_satellites),
        "gateway_visible_satellites": list(item.gateway_visible_satellites),
        "failed_satellites": list(item.failed_satellites),
        "client_component_id": item.client_component_id,
        "gateway_component_id": item.gateway_component_id,
        "last_path": None if item.last_path is None else list(item.last_path),
        "next_path": None if item.next_path is None else list(item.next_path),
    }


def _routes(result: RunResult) -> list[dict[str, object]]:
    """Записи `routes`: ровно одна на пару «отсчёт — клиент», внешний порядок по времени.

    Клиенты идут в порядке сценария, а не в порядке словаря маршрутов: файл читают и
    сравнивают построчно, и порядок записей должен зависеть только от входных данных.
    """
    step_s = result.scenario.environment.step_s
    client_ids = result.scenario.client_ids
    paths = result.routes.paths
    return [
        {
            "t_s": tick * step_s,
            "client_id": client_id,
            "path": [] if (path := paths[client_id][tick]) is None else list(path),
        }
        for tick in range(result.routes.ticks)
        for client_id in client_ids
    ]


def build_export(result: RunResult, run_id: str | None = None) -> dict[str, object]:
    """Результат Run в структуру `cosmo-A-result-1.0`.

    `run_id` приходит снаружи: идентификатор Run заводит слой хранения, ядро его не
    знает. Поле остаётся в файле со значением `null` при расчёте из CLI, чтобы формат не
    зависел от того, кто запустил расчёт. `recommendation` ядро не добавляет: она
    сравнивает несколько Run между собой и живёт на уровне выше (`04_CORE.md` §6).
    """
    return {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "run_id": run_id,
        "engine_version": result.engine_version,
        "routing_policy": str(result.routing_policy),
        "config_hash": result.config_hash,
        "effective_scenario": to_dict(result.scenario),
        "routes": _routes(result),
        "metrics": {
            "clients": [_client_metrics(item) for item in result.aggregate.clients],
            "config": _config_metrics(result.aggregate.config),
        },
        "outages": [_outage(item) for item in result.aggregate.outages],
    }


def dumps_export(export: Mapping[str, object]) -> str:
    """Текст файла выгрузки: отступ 2, кириллица как есть, перевод строки в конце."""
    return (
        json.dumps(export, ensure_ascii=False, indent=2, sort_keys=False, allow_nan=False) + "\n"
    )


def dump_export(export: Mapping[str, object], path: str | Path) -> None:
    """Пишет выгрузку в файл.

    `newline=""` оставляет в файле ровно те переводы строк, которые сформировал
    `json.dumps`: без него Windows подменил бы `\\n` на `\\r\\n`, и файл, собранный на
    двух системах из одной конфигурации, перестал бы совпадать байт в байт.
    """
    Path(path).write_text(dumps_export(export), encoding="utf-8", newline="")


def _require_str(payload: Mapping[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str):
        raise ExportError(f"поле {key} отсутствует или не является строкой", path=key)
    return value


def _parse_routes(raw: Sequence[object], scenario: Scenario) -> tuple[ExportRoute, ...]:
    """Разбор `routes` с проверкой инвариантов 9 и 10 `10_FIXTURES.md` §2."""
    step_s = scenario.environment.step_s
    expected_count = scenario.ticks * len(scenario.client_ids)
    if len(raw) != expected_count:
        raise ExportError(
            f"записей маршрутов {len(raw)}, ожидается {expected_count}", path="routes"
        )
    known_clients = frozenset(scenario.client_ids)
    seen: set[tuple[int, str]] = set()
    routes: list[ExportRoute] = []
    for index, item in enumerate(raw):
        where = f"routes[{index}]"
        if not isinstance(item, Mapping):
            raise ExportError("запись маршрута не является объектом", path=where)
        t_s = item.get("t_s")
        client_id = item.get("client_id")
        path = item.get("path")
        if not isinstance(t_s, int) or isinstance(t_s, bool) or t_s % step_s != 0:
            raise ExportError("t_s не принадлежит сетке отсчётов", path=f"{where}.t_s")
        if not isinstance(client_id, str) or client_id not in known_clients:
            raise ExportError("client_id не найден в сценарии", path=f"{where}.client_id")
        if not isinstance(path, list) or not all(isinstance(node, str) for node in path):
            raise ExportError("path не является списком идентификаторов", path=f"{where}.path")
        key = (t_s, client_id)
        if key in seen:
            raise ExportError(f"пара ({t_s}, {client_id}) встречается дважды", path=where)
        seen.add(key)
        routes.append(ExportRoute(t_s=t_s, client_id=client_id, path=tuple(path)))
    return tuple(routes)


def loads_export(text: str) -> LoadedExport:
    """Разбирает текст выгрузки; `effective_scenario` проходит полную валидацию."""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise ExportError(f"файл не является корректным JSON: {error.msg}", path="") from error
    if not isinstance(payload, Mapping):
        raise ExportError("корень файла выгрузки не является объектом", path="")
    schema_version = _require_str(payload, "schema_version")
    if schema_version != EXPORT_SCHEMA_VERSION:
        raise ExportError(
            f"схема {schema_version!r}, поддерживается {EXPORT_SCHEMA_VERSION!r}",
            path="schema_version",
        )
    policy_name = _require_str(payload, "routing_policy")
    try:
        policy = RoutingPolicy(policy_name)
    except ValueError as error:
        raise ExportError(
            f"неизвестная политика маршрутизации {policy_name!r}", path="routing_policy"
        ) from error
    raw_scenario = payload.get("effective_scenario")
    try:
        scenario = parse(raw_scenario)
    except ScenarioError as error:
        raise ScenarioError(
            [
                ScenarioIssue(
                    code=issue.code,
                    path=f"effective_scenario.{issue.path}" if issue.path else "effective_scenario",
                    message=issue.message,
                    details=issue.details,
                )
                for issue in error.errors
            ]
        ) from error
    run_id = payload.get("run_id")
    if run_id is not None and not isinstance(run_id, str):
        raise ExportError("run_id не является строкой", path="run_id")
    raw_routes = payload.get("routes")
    if not isinstance(raw_routes, list):
        raise ExportError("поле routes отсутствует или не является списком", path="routes")
    return LoadedExport(
        schema_version=schema_version,
        run_id=run_id,
        engine_version=_require_str(payload, "engine_version"),
        routing_policy=policy,
        config_hash=_require_str(payload, "config_hash"),
        scenario=scenario,
        routes=_parse_routes(raw_routes, scenario),
    )


def load_export(path: str | Path) -> LoadedExport:
    """Читает файл выгрузки и проверяет его формат."""
    return loads_export(Path(path).read_text(encoding="utf-8"))
