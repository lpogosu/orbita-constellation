"""Оркестрация одного Run: pipeline `04_CORE.md` §2 от сценария до метрик.

Ядро не знает ни про очередь задач, ни про хранилище (ADR-001): стадия `persist`
объявляется, чтобы вызывающий слой мог показать её в прогрессе, но ничего не сохраняет.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from orbita_core import ENGINE_VERSION, contacts, metrics
from orbita_core import scenario as scenario_module
from orbita_core.contacts import ContactPlan
from orbita_core.metrics import AggregateResult
from orbita_core.routing import RouteTable, RoutingPolicy, route_all
from orbita_core.scenario import Scenario


class RunStage(StrEnum):
    """Стадии выполнения Run в порядке `03_GLOSSARY.md` §3.4."""

    VALIDATE = "validate"
    GEOMETRY = "geometry"
    CONTACTS = "contacts"
    ROUTING = "routing"
    ANALYTICS = "analytics"
    PERSIST = "persist"
    COMPLETE = "complete"


# Наблюдатель прогресса: стадия, число посчитанных отсчётов и их общее число.
ProgressCallback = Callable[[RunStage, int, int], None]


@dataclass(frozen=True, slots=True, eq=False)
class RunResult:
    """Всё, что ядро знает о завершённом Run.

    `scenario` — канонический effective scenario: именно он уходит в экспорт и именно по
    нему посчитан `config_hash`. Сравнение по значению отключено, потому что `plan` и
    `routes` содержат массивы NumPy.
    """

    scenario: Scenario
    plan: ContactPlan
    routes: RouteTable
    aggregate: AggregateResult
    config_hash: str
    engine_version: str
    routing_policy: RoutingPolicy
    duration_ms: int


# Стадии, после которых сетка отсчётов уже пройдена целиком: прогресс на них полный.
_STAGES_AFTER_ROUTING: Final[frozenset[RunStage]] = frozenset(
    {RunStage.ANALYTICS, RunStage.PERSIST, RunStage.COMPLETE}
)


def run(
    scenario: Scenario | Mapping[str, object],
    policy: RoutingPolicy,
    *,
    progress: ProgressCallback | None = None,
    backup_paths: bool = True,
) -> RunResult:
    """Полный расчёт одного варианта: валидация, контакты, маршруты, метрики.

    Принимает как разобранный `Scenario`, так и сырой JSON-объект: HTTP-слой получает
    словарь из тела запроса, а повторный запуск идёт от уже канонизированного сценария.

    `InternalInconsistencyError` из маршрутизации и диагностики наружу не перехватывается:
    расхождение обхода в ширину с Union-Find означает ошибку ядра, и Run обязан упасть,
    а не отдать правдоподобные числа (`04_CORE.md` §3.4).
    """
    started = time.perf_counter()
    effective = scenario if isinstance(scenario, Scenario) else scenario_module.parse(scenario)
    total_ticks = effective.ticks

    def report(stage: RunStage) -> None:
        if progress is None:
            return
        # Единственная стадия с наблюдаемым по отсчётам прогрессом — маршрутизация, но
        # `route_all` считает всю сетку одним вызовом и обратного вызова не принимает.
        # Поэтому доля посчитанных отсчётов переключается с нуля на полную сетку ровно
        # тогда, когда маршрутизация закончилась.
        completed = total_ticks if stage in _STAGES_AFTER_ROUTING else 0
        progress(stage, completed, total_ticks)

    report(RunStage.VALIDATE)
    config_hash = scenario_module.config_hash(effective, str(policy))

    # Позиции и активность аппаратов считаются внутри `contacts.build` одним проходом по
    # всей сетке: отдельного массива координат pipeline не требует, а второй проход по
    # геометрии стоил бы столько же, сколько первый.
    report(RunStage.GEOMETRY)
    report(RunStage.CONTACTS)
    plan = contacts.build(effective)

    report(RunStage.ROUTING)
    routes = route_all(plan, policy)

    report(RunStage.ANALYTICS)
    aggregate = metrics.aggregate(
        plan,
        routes,
        target_availability=effective.environment.target_availability,
        backup_paths=backup_paths,
    )

    report(RunStage.PERSIST)
    duration_ms = round((time.perf_counter() - started) * 1000)
    report(RunStage.COMPLETE)
    return RunResult(
        scenario=effective,
        plan=plan,
        routes=routes,
        aggregate=aggregate,
        config_hash=config_hash,
        engine_version=ENGINE_VERSION,
        routing_policy=policy,
        duration_ms=duration_ms,
    )
