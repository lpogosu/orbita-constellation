"""Общая обвязка расчётных скриптов анализа: загрузка сценариев, прогон, запись JSON.

Скрипты этого каталога вызывают расчётное ядро `orbita_core` напрямую как библиотеку и
ничего не меняют ни в нём, ни в сценариях на диске: варианты конфигурации собираются в
памяти из словаря сценария. Каждое число документа `docs/19_ANALYSIS.md` приходит отсюда.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from orbita_core import diagnosis, engine
from orbita_core import scenario as scenario_module
from orbita_core.contacts import ContactPlan
from orbita_core.diagnosis import OutageCause, TickView
from orbita_core.engine import RunResult
from orbita_core.routing import RouteTable, RoutingPolicy
from orbita_core.scenario import Scenario

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
SCENARIO_DIR: Final[Path] = REPO_ROOT / "scenarios"
RESULTS_DIR: Final[Path] = Path(__file__).resolve().parent / "results"

# Сценарии кейса в том порядке, в котором они разбираются в документе.
CASE_SCENARIOS: Final[tuple[str, ...]] = (
    "01_full_constellation",
    "02_first_launch",
    "03_satellite_outages",
    "04_link_range",
)

DEFAULT_POLICY: Final[RoutingPolicy] = RoutingPolicy.BFS_SHORTEST


def load_dict(name: str) -> dict[str, object]:
    """Сценарий кейса как словарь: варианты строятся правкой копии этого словаря."""
    raw = json.loads((SCENARIO_DIR / f"{name}.json").read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise TypeError(f"сценарий {name} не является объектом JSON")
    return raw


def parse(data: Mapping[str, object]) -> Scenario:
    """Канонический сценарий из словаря — та же проверка, что и у HTTP-слоя."""
    return scenario_module.parse(data)


def run(scenario: Scenario | Mapping[str, object], policy: RoutingPolicy) -> RunResult:
    """Полный расчёт суток.

    Резервные маршруты считаются всегда: `backup_path_count_min` входит в порядок
    сравнения вариантов `ranking.RANKING_ORDER`, а на сетке 720 отсчётов его подсчёт
    стоит доли секунды.
    """
    return engine.run(scenario, policy, backup_paths=True)


def cause_tick_counts(plan: ContactPlan, routes: RouteTable) -> dict[str, dict[str, int]]:
    """Распределение отсчётов без маршрута по причинам — по каждому клиенту.

    Метрики ядра считают причины по интервалам перерыва, а здесь нужен вес причины во
    времени: интервал в один отсчёт и интервал в час дают в `outage_count_by_cause`
    одинаковую единицу. На отсчёте могут сработать несколько причин сразу — например,
    клиент не видит ни одного аппарата и одновременно распалась межспутниковая сеть, —
    поэтому сумма по причинам не обязана равняться числу отсчётов без маршрута.
    """
    counts: dict[str, dict[str, int]] = {client: defaultdict(int) for client in routes.clients}
    views: dict[int, TickView] = {}
    for client in routes.clients:
        reachable = routes.reachable(client)
        for tick in range(plan.ticks):
            if reachable[tick]:
                continue
            view = views.get(tick)
            if view is None:
                view = diagnosis.build_tick_view(plan, tick)
                views[tick] = view
            for cause in diagnosis.triggered_causes(view, client):
                counts[client][cause.value] += 1
    return {client: dict(sorted(value.items())) for client, value in counts.items()}


@dataclass(frozen=True, slots=True)
class ClientSummary:
    """Показатели одного клиента в виде, пригодном для JSON и таблиц документа."""

    client_id: str
    availability: float
    visibility: float
    max_gap_s: int
    mean_hops: float | None
    max_hops: int | None
    route_switches: int
    target_met: bool
    outage_count: int
    outage_total_s: int
    outage_count_by_cause: dict[str, int]


def client_summaries(result: RunResult) -> list[ClientSummary]:
    """Клиентские метрики прогона вместе с числом и суммарной длительностью перерывов."""
    outage_count: dict[str, int] = defaultdict(int)
    outage_total: dict[str, int] = defaultdict(int)
    for interval in result.aggregate.outages:
        outage_count[interval.client_id] += 1
        outage_total[interval.client_id] += interval.duration_s
    return [
        ClientSummary(
            client_id=client.client_id,
            availability=client.availability,
            visibility=client.visibility,
            max_gap_s=client.max_gap_s,
            mean_hops=client.mean_hops,
            max_hops=client.max_hops,
            route_switches=client.route_switches,
            target_met=client.target_met,
            outage_count=outage_count[client.client_id],
            outage_total_s=outage_total[client.client_id],
            outage_count_by_cause={
                cause.value: count for cause, count in sorted(client.outage_count_by_cause.items())
            },
        )
        for client in result.aggregate.clients
    ]


def summary_to_dict(summary: ClientSummary) -> dict[str, object]:
    """Клиентская сводка как обычный словарь — `dataclasses.asdict` здесь избыточен."""
    return {
        "client_id": summary.client_id,
        "availability": summary.availability,
        "visibility": summary.visibility,
        "max_gap_s": summary.max_gap_s,
        "mean_hops": summary.mean_hops,
        "max_hops": summary.max_hops,
        "route_switches": summary.route_switches,
        "target_met": summary.target_met,
        "outage_count": summary.outage_count,
        "outage_total_s": summary.outage_total_s,
        "outage_count_by_cause": summary.outage_count_by_cause,
    }


def config_summary(result: RunResult) -> dict[str, object]:
    """Свёртка конфигурации: то же, что `ConfigMetrics`, но без объектов-перечислений."""
    config = result.aggregate.config
    return {
        "min_client_availability": config.min_client_availability,
        "mean_client_availability": config.mean_client_availability,
        "worst_max_gap_s": config.worst_max_gap_s,
        "mean_hops": config.mean_hops,
        "max_hops": config.max_hops,
        "route_switches_total": config.route_switches_total,
        "backup_path_count_min": config.backup_path_count_min,
        "target_met_clients": list(config.target_met_clients),
        "outage_count_by_cause": {
            cause.value: count for cause, count in sorted(config.outage_count_by_cause.items())
        },
    }


def run_summary(
    scenario: Scenario | Mapping[str, object],
    policy: RoutingPolicy = DEFAULT_POLICY,
    *,
    with_causes: bool = False,
) -> dict[str, object]:
    """Прогон и его итог одним вызовом: клиентские метрики, свёртка, при желании причины."""
    result = run(scenario, policy)
    environment = result.scenario.environment
    summary: dict[str, object] = {
        "policy": str(policy),
        "config_hash": result.config_hash,
        "engine_version": result.engine_version,
        "grid": {
            "horizon_s": environment.horizon_s,
            "step_s": environment.step_s,
            "ticks": result.scenario.ticks,
        },
        "clients": [summary_to_dict(item) for item in client_summaries(result)],
        "config": config_summary(result),
    }
    if with_causes:
        summary["cause_ticks"] = cause_tick_counts(result.plan, result.routes)
    return summary


def site_visibility(plan: ContactPlan, site_id: str) -> float:
    """Доля отсчётов, на которых пункту виден хотя бы один действующий аппарат.

    Клиентская видимость есть в метриках ядра, а шлюзовой там нет: свёртка по
    конфигурации считает показатели клиентов. Для разбора причин нужна именно шлюзовая —
    она ограничивает всех клиентов сразу.
    """
    return sum(1 for tick in range(plan.ticks) if plan.visible_satellites(tick, site_id)) / (
        plan.ticks
    )


def all_causes() -> tuple[str, ...]:
    """Имена причин в порядке глоссария: колонки таблиц документа идут в нём же."""
    return tuple(cause.value for cause in OutageCause)


def write_json(name: str, payload: Mapping[str, object]) -> Path:
    """Сырой результат на диск. Ключи не сортируются: порядок задаёт скрипт."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
