"""Resilience X-Ray: вклад каждого аппарата в устойчивость конфигурации (ADR-007).

Вопрос, на который отвечает модуль, звучит «что будет, если этого аппарата не станет», и
ответ на него даётся не мерой центральности, а тем же расчётом, которым получены
обязательные метрики: аппарату назначается отказ на весь горизонт, сутки считаются
заново, и разница показывается в тех же единицах, что и результат — доля отсчётов и
секунды перерыва (`04_CORE.md` §5.3).

Рядом считаются две структурные величины базового плана: доля отсчётов, где аппарат
входит в минимальный вершинный разрез клиента, и доля отсчётов, где он разделяет сеть.
Они не заменяют контрфактический прогон, а объясняют его: прогон говорит «на сколько
хуже», разрез и точка сочленения — «почему именно этот аппарат».
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace

from orbita_core import ENGINE_VERSION, engine, graph
from orbita_core import scenario as scenario_module
from orbita_core.contacts import ContactPlan
from orbita_core.engine import RunResult
from orbita_core.metrics import ConfigMetrics
from orbita_core.routing import RouteTable, RoutingPolicy, disjoint_paths
from orbita_core.scenario import Scenario, Unavailability

# Наблюдатель прогресса прогона: сколько аппаратов посчитано и сколько их всего.
ProgressCallback = Callable[[int, int], None]

# Признак отмены: вызывается между аппаратами и отвечает, нужно ли прекращать работу.
CancelCheck = Callable[[], bool]


class CriticalityCancelledError(RuntimeError):
    """Прогон прерван по требованию вызывающего.

    Отдельный тип, а не возврат неполного отчёта: частичный список аппаратов выглядел бы
    как готовый результат, в котором просто нет критичных машин.
    """


@dataclass(frozen=True, slots=True)
class SatelliteCriticality:
    """Вклад одного аппарата в устойчивость (`04_CORE.md` §5.3).

    Дельты знаковые и считаются как «стало минус было», поэтому падение доступности —
    отрицательное число, а рост худшего перерыва — положительное.
    """

    satellite_id: str
    plane_id: str
    delta_min_client_availability: float
    delta_worst_max_gap_s: int
    affected_clients: tuple[str, ...]
    min_cut_frequency: float
    articulation_frequency: float


@dataclass(frozen=True, slots=True)
class CriticalityReport:
    """Отчёт по всем проверенным аппаратам вместе с базой, от которой считались дельты."""

    engine_version: str
    routing_policy: RoutingPolicy
    config_hash: str
    base: ConfigMetrics
    satellites: tuple[SatelliteCriticality, ...]
    duration_ms: int


def criticality(
    scenario: Scenario | Mapping[str, object],
    policy: RoutingPolicy,
    *,
    progress: ProgressCallback | None = None,
    cancel_check: CancelCheck | None = None,
    satellites: Sequence[str] | None = None,
) -> CriticalityReport:
    """Контрфактический прогон по каждому аппарату группировки.

    Базовый расчёт выполняется один раз, затем для каждого аппарата считается тот же
    сценарий с его отказом на весь горизонт. Резервные маршруты в прогонах не считаются:
    `backup_path_count_min` не участвует ни в одной дельте отчёта, а его подсчёт стоит
    дороже всего остального расчёта вместе взятого.

    `satellites` ограничивает список проверяемых аппаратов — нужен интерфейсу, который
    пересчитывает один аппарат после правки, и тестам, которым не нужен полный прогон.
    """
    started = time.perf_counter()
    effective = scenario if isinstance(scenario, Scenario) else scenario_module.parse(scenario)
    base = engine.run(effective, policy, backup_paths=False)

    targets = _targets(effective, base.plan, satellites)
    min_cut_ticks = _min_cut_ticks(base.plan, base.routes)
    articulation_ticks = _articulation_ticks(base.plan)
    base_availability = {client.client_id: client.availability for client in base.aggregate.clients}
    plane_of = {satellite.id: satellite.plane_id for satellite in effective.satellites}

    total = len(targets)
    _report(progress, 0, total)
    entries: list[SatelliteCriticality] = []
    for done, satellite_id in enumerate(targets, start=1):
        if cancel_check is not None and cancel_check():
            raise CriticalityCancelledError(
                f"прогон критичности прерван после {done - 1} из {total} аппаратов"
            )
        failed = _run_without(effective, policy, satellite_id)
        entries.append(
            SatelliteCriticality(
                satellite_id=satellite_id,
                plane_id=plane_of[satellite_id],
                delta_min_client_availability=(
                    failed.aggregate.config.min_client_availability
                    - base.aggregate.config.min_client_availability
                ),
                delta_worst_max_gap_s=(
                    failed.aggregate.config.worst_max_gap_s - base.aggregate.config.worst_max_gap_s
                ),
                affected_clients=tuple(
                    client.client_id
                    for client in failed.aggregate.clients
                    if client.availability < base_availability[client.client_id]
                ),
                min_cut_frequency=min_cut_ticks.get(satellite_id, 0) / base.plan.ticks,
                articulation_frequency=articulation_ticks.get(satellite_id, 0) / base.plan.ticks,
            )
        )
        _report(progress, done, total)

    return CriticalityReport(
        engine_version=ENGINE_VERSION,
        routing_policy=policy,
        config_hash=base.config_hash,
        base=base.aggregate.config,
        satellites=tuple(sorted(entries, key=_order)),
        duration_ms=round((time.perf_counter() - started) * 1000),
    )


def _order(entry: SatelliteCriticality) -> tuple[float, int, str]:
    """Ключ сортировки: самый критичный аппарат идёт первым.

    Ведущая метрика — падение худшей доступности клиента; при равном падении выше тот, у
    кого сильнее растёт худший перерыв. Идентификатор в конце ключа нужен не для смысла, а
    для повторяемости: аппаратов с нулевым влиянием в группировке большинство, и без него
    их порядок зависел бы от порядка вставки.
    """
    return (
        entry.delta_min_client_availability,
        -entry.delta_worst_max_gap_s,
        entry.satellite_id,
    )


def _report(progress: ProgressCallback | None, done: int, total: int) -> None:
    if progress is not None:
        progress(done, total)


def _targets(
    scenario: Scenario, plan: ContactPlan, requested: Sequence[str] | None
) -> tuple[str, ...]:
    """Аппараты, которые есть смысл проверять, в порядке сценария.

    Аппарат, не работающий ни на одном отсчёте — не выведенный на орбиту или уже
    отказавший по условиям сценария, — из прогона исключается: его отказ ничего не
    меняет, а прогон по нему стоит столько же, сколько по работающему.
    """
    active = {
        satellite_id
        for index, satellite_id in enumerate(plan.satellite_ids)
        if bool(plan.active[:, index].any())
    }
    if requested is None:
        return tuple(satellite.id for satellite in scenario.satellites if satellite.id in active)
    unknown = [
        satellite_id for satellite_id in requested if satellite_id not in scenario.satellite_index
    ]
    if unknown:
        raise ValueError(f"в сценарии нет аппаратов: {', '.join(unknown)}")
    return tuple(satellite_id for satellite_id in requested if satellite_id in active)


def _run_without(scenario: Scenario, policy: RoutingPolicy, satellite_id: str) -> RunResult:
    """Расчёт того же сценария с отказом одного аппарата на весь горизонт.

    Отказ добавляется в сценарий, а не вычёркивается из contact plan: правило активности
    у отказа одно на весь расчёт, и второй его реализации, которая могла бы разойтись с
    первой, здесь быть не должно (`01_SPEC.md` §2.6).
    """
    outage = Unavailability(
        node_id=satellite_id, start_s=0.0, end_s=float(scenario.environment.horizon_s)
    )
    without = replace(scenario, failures=(*scenario.failures, outage))
    return engine.run(without, policy, backup_paths=False)


def _min_cut_ticks(plan: ContactPlan, routes: RouteTable) -> dict[str, int]:
    """Сколько отсчётов аппарат входит в минимальный разрез хотя бы одного клиента.

    Отсчёты без маршрута пропускаются: поток клиент → шлюз там нулевой, и разрез пуст —
    считать max-flow, чтобы получить пустое множество, незачем. Величина берётся с
    базового плана один раз для всех аппаратов: разрез описывает конфигурацию, а не
    конкретный отказ.
    """
    counts: dict[str, int] = {}
    for tick in range(plan.ticks):
        in_cut: set[str] = set()
        for client in routes.clients:
            if routes.paths[client][tick] is None:
                continue
            in_cut.update(disjoint_paths(plan, tick, client)[2])
        for satellite_id in in_cut:
            counts[satellite_id] = counts.get(satellite_id, 0) + 1
    return counts


def _articulation_ticks(plan: ContactPlan) -> dict[str, int]:
    """Сколько отсчётов узел разделяет сеть на части."""
    counts: dict[str, int] = {}
    for tick in range(plan.ticks):
        for node in graph.articulation_points(plan, tick):
            counts[node] = counts.get(node, 0) + 1
    return counts
