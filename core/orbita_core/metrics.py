"""Показатели клиента и конфигурации, интервалы перерывов связи (`04_CORE.md` §5).

Все величины считаются по одной и той же сетке отсчётов, что и маршруты: доля — это число
отсчётов, делённое на их общее число, а длительность — число отсчётов, умноженное на
`step_s` (`01_SPEC.md` §2.2, §7). Поэтому сумма перерывов клиента и его доступность
согласованы по построению, а не проверкой постфактум.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from statistics import fmean

import numpy as np
from numpy.typing import NDArray

from orbita_core.contacts import ContactPlan
from orbita_core.diagnosis import (
    OutageCause,
    TickView,
    build_evidence,
    build_tick_view,
    diagnose,
    triggered_causes,
)
from orbita_core.routing import RouteTable, disjoint_paths


@dataclass(frozen=True, slots=True)
class OutageInterval:
    """Перерыв связи клиента: `[start_s; end_s)` и доказательства причины.

    Поля повторяют `05_API.md` §1: HTTP-слой отдаёт интервал без пересборки.
    """

    client_id: str
    start_s: int
    end_s: int
    duration_s: int
    truncated_by_horizon: bool
    primary_cause: OutageCause
    causes: tuple[OutageCause, ...]
    client_visible_satellites: tuple[str, ...]
    gateway_visible_satellites: tuple[str, ...]
    failed_satellites: tuple[str, ...]
    client_component_id: int | None
    gateway_component_id: int | None
    last_path: tuple[str, ...] | None
    next_path: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class ClientMetrics:
    """Показатели одного клиентского пункта (`01_SPEC.md` §7, `03_GLOSSARY.md` §4).

    `mean_hops` и `max_hops` отсутствуют, если маршрута не было ни на одном отсчёте:
    среднее по пустому множеству отсчётов не определено, а ноль означал бы маршрут без
    переходов.
    """

    client_id: str
    availability: float
    visibility: float
    max_gap_s: int
    mean_hops: float | None
    max_hops: int | None
    route_switches: int
    target_met: bool
    outage_count_by_cause: dict[OutageCause, int]


@dataclass(frozen=True, slots=True)
class ConfigMetrics:
    """Показатели конфигурации: свёртка клиентских метрик (`04_CORE.md` §5.2)."""

    min_client_availability: float
    mean_client_availability: float
    worst_max_gap_s: int
    mean_hops: float | None
    max_hops: int | None
    route_switches_total: int
    backup_path_count_min: int | None
    outage_count_by_cause: dict[OutageCause, int]
    target_met_clients: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AggregateResult:
    """Полный набор показателей запуска: по клиентам, по конфигурации и перерывы."""

    clients: list[ClientMetrics]
    config: ConfigMetrics
    outages: list[OutageInterval]


def outage_runs(reachable: NDArray[np.bool_]) -> list[tuple[int, int]]:
    """Максимальные последовательности отсчётов без пути как полуинтервалы `[start; stop)`.

    Границы ищутся по переходам в дополненной по краям маске, а не циклом с состоянием:
    так краевой перерыв обрабатывается тем же кодом, что и внутренний, и не требует
    отдельной ветки.
    """
    padded = np.concatenate(([True], reachable, [True]))
    changes = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(start), int(stop)) for start, stop in changes.reshape(-1, 2).tolist()]


def longest_gap_ticks(reachable: NDArray[np.bool_]) -> int:
    """Длина самого долгого перерыва в отсчётах; краевые перерывы учитываются (ADR-004)."""
    return max((stop - start for start, stop in outage_runs(reachable)), default=0)


def _site_visibility(plan: ContactPlan, site_id: str) -> NDArray[np.bool_]:
    """Маска отсчётов, на которых пункту виден хотя бы один активный аппарат.

    Наземное ребро существует только при выполненном условии по углу возвышения и
    активности аппарата, поэтому видимость читается прямо из битовой матрицы.
    """
    node = plan.node_index[site_id]
    columns = np.flatnonzero(plan.edges[:, 1] == node)
    if columns.size == 0:
        return np.zeros(plan.ticks, dtype=np.bool_)
    return np.asarray(plan.bits[:, columns].any(axis=1), dtype=np.bool_)


def _gateway_visible_counts(plan: ContactPlan) -> NDArray[np.int64]:
    """Число аппаратов, видимых хотя бы одному доступному шлюзу, на каждом отсчёте.

    Рёбра недоступного шлюза уже сняты в contact plan, поэтому объединение по шлюзам
    автоматически учитывает периоды недоступности.
    """
    union = np.zeros((plan.ticks, plan.satellite_count), dtype=np.bool_)
    for gateway_id in plan.gateway_ids:
        node = plan.node_index[gateway_id]
        columns = np.flatnonzero(plan.edges[:, 1] == node)
        if columns.size:
            union[:, plan.edges[columns, 0]] |= plan.bits[:, columns]
    return np.asarray(union.sum(axis=1), dtype=np.int64)


def _forced_single_path(
    client_counts: NDArray[np.int64], gateway_counts: NDArray[np.int64], tick: int
) -> bool:
    """Признак того, что все маршруты клиента на отсчёте обязаны идти через один аппарат.

    Если вход в сеть или выход из неё состоит ровно из одного аппарата, вершинно
    непересекающийся маршрут может быть только один, и считать max-flow незачем.
    """
    return bool(client_counts[tick] == 1 or gateway_counts[tick] == 1)


def _backup_path_count_min(plan: ContactPlan, routes: RouteTable) -> int | None:
    """Минимум `backup_path_count` по клиентам и отсчётам с маршрутом (ADR-007).

    Полный max-flow на каждом отсчёте стоит дороже всего остального расчёта, поэтому
    сначала ищется отсчёт, где число маршрутов заведомо равно единице. Единица — это
    минимум из возможных там, где маршрут есть (инвариант 19), так что найденный такой
    отсчёт сразу даёт ответ и делает перебор ненужным.
    """
    gateway_counts = _gateway_visible_counts(plan)
    client_counts = {
        client: np.asarray(
            plan.bits[:, np.flatnonzero(plan.edges[:, 1] == plan.node_index[client])].sum(axis=1),
            dtype=np.int64,
        )
        for client in routes.clients
    }
    pending: list[tuple[str, int]] = []
    for client in routes.clients:
        for tick, path in enumerate(routes.paths[client]):
            if path is None:
                continue
            if _forced_single_path(client_counts[client], gateway_counts, tick):
                return 1
            pending.append((client, tick))
    if not pending:
        return None
    return min(disjoint_paths(plan, tick, client)[0] for client, tick in pending)


def _interval_causes(
    view_of: dict[int, TickView], routes: RouteTable, client: str, start: int, stop: int
) -> tuple[OutageCause, ...]:
    """Причины перерыва: порядок задаёт первый отсчёт, состав — весь интервал.

    Первый отсчёт определяет, с чего перерыв начался, и именно его причина показывается
    инженеру как основная. Но по ходу перерыва обстановка меняется — например, разрыв
    межспутниковой сети сменяется полной потерей видимости, — и такая причина была бы
    потеряна, если бы список брался только с начала интервала. Поэтому `causes` —
    объединение по всем отсчётам перерыва с сохранением порядка глоссария.
    """
    seen: set[OutageCause] = set()
    first: OutageCause | None = None
    for tick in range(start, stop):
        causes = triggered_causes(view_of[tick], client)
        if not causes:
            # Диагноз с причиной INTERNAL_INCONSISTENCY и исключение собирает сама
            # диагностика: здесь известно только то, что маршрута нет.
            diagnose(view_of[tick], routes, client)
        if first is None:
            first = causes[0]
        seen.update(causes)
    if first is None:
        raise ValueError(f"пустой интервал перерыва клиента {client}")
    ordered = (cause for cause in OutageCause if cause in seen and cause is not first)
    return (first, *ordered)


def aggregate(
    plan: ContactPlan,
    routes: RouteTable,
    *,
    target_availability: float,
    backup_paths: bool = True,
) -> AggregateResult:
    """Показатели клиентов и конфигурации, интервалы перерывов с причинами.

    `target_availability` передаётся отдельно, а не читается из contact plan: план хранит
    геометрию контактов и ничего не знает о целевом ориентире сценария (`01_SPEC.md` §1).
    `backup_paths=False` отключает подсчёт резервных маршрутов для предварительных
    расчётов, где важна скорость: `backup_path_count_min` тогда отсутствует.
    """
    step_s = plan.step_s
    total_ticks = plan.ticks
    reachable = {client: routes.reachable(client) for client in routes.clients}
    runs = {client: outage_runs(reachable[client]) for client in routes.clients}

    # Состояние отсчёта строится один раз и используется всеми клиентами, у которых на нём
    # перерыв: компоненты связности — самая дорогая часть диагностики.
    clients_at: dict[int, list[str]] = defaultdict(list)
    for client, intervals in runs.items():
        for start, stop in intervals:
            for tick in range(start, stop):
                clients_at[tick].append(client)
    view_of = {tick: build_tick_view(plan, tick) for tick in sorted(clients_at)}

    outages: list[OutageInterval] = []
    metrics: list[ClientMetrics] = []
    for client in routes.clients:
        counts: dict[OutageCause, int] = defaultdict(int)
        for start, stop in runs[client]:
            causes = _interval_causes(view_of, routes, client, start, stop)
            evidence = build_evidence(view_of[start], routes, client)
            counts[causes[0]] += 1
            outages.append(
                OutageInterval(
                    client_id=client,
                    start_s=start * step_s,
                    end_s=stop * step_s,
                    duration_s=(stop - start) * step_s,
                    # Перерыв обрезан границей расчёта, если он касается края сетки: что
                    # происходило до нуля и после горизонта, расчёт не знает (ADR-004).
                    truncated_by_horizon=start == 0 or stop == total_ticks,
                    primary_cause=causes[0],
                    causes=causes,
                    client_visible_satellites=evidence.client_visible_satellites,
                    gateway_visible_satellites=evidence.gateway_visible_satellites,
                    failed_satellites=evidence.failed_satellites,
                    client_component_id=evidence.client_component_id,
                    gateway_component_id=evidence.gateway_component_id,
                    last_path=evidence.last_path,
                    next_path=evidence.next_path,
                )
            )
        hops = [value for value in routes.hops[client] if value is not None]
        availability = float(reachable[client].mean())
        metrics.append(
            ClientMetrics(
                client_id=client,
                availability=availability,
                visibility=float(_site_visibility(plan, client).mean()),
                max_gap_s=longest_gap_ticks(reachable[client]) * step_s,
                mean_hops=fmean(hops) if hops else None,
                max_hops=max(hops) if hops else None,
                route_switches=routes.route_switches[client],
                target_met=availability >= target_availability,
                outage_count_by_cause=dict(counts),
            )
        )

    backup_min = _backup_path_count_min(plan, routes) if backup_paths else None
    return AggregateResult(
        clients=metrics, config=_config_metrics(metrics, backup_min), outages=outages
    )


def _config_metrics(clients: list[ClientMetrics], backup_min: int | None) -> ConfigMetrics:
    """Свёртка клиентских метрик по конфигурации.

    `mean_hops` усредняется по клиентам, а не по всем парам «клиент — отсчёт»: иначе
    клиент с высокой доступностью давал бы больше отсчётов и тянул общее число переходов
    на себя, хотя в свёртках рядом (`min_`, `mean_client_availability`) все клиенты равны.
    """
    if not clients:
        raise ValueError("метрики конфигурации требуют хотя бы одного клиентского пункта")
    hops = [client.mean_hops for client in clients if client.mean_hops is not None]
    max_hops = [client.max_hops for client in clients if client.max_hops is not None]
    counts: dict[OutageCause, int] = defaultdict(int)
    for client in clients:
        for cause, count in client.outage_count_by_cause.items():
            counts[cause] += count
    return ConfigMetrics(
        min_client_availability=min(client.availability for client in clients),
        mean_client_availability=fmean(client.availability for client in clients),
        worst_max_gap_s=max(client.max_gap_s for client in clients),
        mean_hops=fmean(hops) if hops else None,
        max_hops=max(max_hops) if max_hops else None,
        route_switches_total=sum(client.route_switches for client in clients),
        backup_path_count_min=backup_min,
        outage_count_by_cause=dict(counts),
        target_met_clients=tuple(client.client_id for client in clients if client.target_met),
    )
