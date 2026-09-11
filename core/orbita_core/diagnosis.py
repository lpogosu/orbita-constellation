"""Причины отсутствия маршрута и доказательства к ним (ADR-005).

Причина не угадывается по косвенным признакам, а выводится из тех же данных, на которых
строился граф отсчёта: видимые аппараты, доступность шлюзов, метки компонент связности.
Поэтому объяснение разрыва всегда согласовано с расчётом и проверяемо: интерфейсу
передаются не только названия причин, но и аппараты с компонентами, по которым причина
получена (`04_CORE.md` §4).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from orbita_core.contacts import ContactPlan
from orbita_core.graph import available_gateway_nodes, components
from orbita_core.routing import InternalInconsistencyError, RouteTable


class OutageCause(StrEnum):
    """Причины отсутствия маршрута `03_GLOSSARY.md` §3.1.

    Порядок объявления — это порядок таблицы глоссария: `primary_cause` берётся как первая
    сработавшая причина, поэтому перестановка членов меняет поведение диагностики.
    """

    NO_CLIENT_COVERAGE = "NO_CLIENT_COVERAGE"
    GATEWAY_OUTAGE = "GATEWAY_OUTAGE"
    NO_GATEWAY_COVERAGE = "NO_GATEWAY_COVERAGE"
    NETWORK_PARTITION = "NETWORK_PARTITION"
    INTERNAL_INCONSISTENCY = "INTERNAL_INCONSISTENCY"


@dataclass(frozen=True, slots=True)
class Evidence:
    """Данные отсчёта, по которым получена причина (`05_API.md` §1 `OutageInterval`).

    `client_component_id` и `gateway_component_id` — плотные номера компонент связности,
    а не корни Union-Find: корень зависит от порядка объединения и в интерфейсе выглядел бы
    произвольным числом. `None` означает, что у стороны нет видимых аппаратов и компоненты
    у неё нет.
    """

    client_visible_satellites: tuple[str, ...]
    gateway_visible_satellites: tuple[str, ...]
    failed_satellites: tuple[str, ...]
    client_component_id: int | None
    gateway_component_id: int | None
    last_path: tuple[str, ...] | None
    next_path: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class Diagnosis:
    """Причины разрыва на одном отсчёте у одного клиента.

    `causes` содержит все сработавшие причины, `primary_cause` — первую по порядку
    `03_GLOSSARY.md` §3.1. На отсчёте с маршрутом обе величины пусты: объяснять нечего.
    """

    primary_cause: OutageCause | None
    causes: tuple[OutageCause, ...]
    evidence: Evidence


class InconsistentDiagnosisError(InternalInconsistencyError):
    """Диагностика разошлась с результатом маршрутизации.

    Наследует исключение маршрутизации, потому что это тот же класс ошибки расчёта и
    вызывающий код ловит его одним `except`. Сам диагноз приложен к исключению: без него
    разбирать расхождение пришлось бы повторным прогоном.
    """

    def __init__(self, message: str, *, tick: int, client: str, diagnosis: Diagnosis) -> None:
        super().__init__(message, tick=tick, client=client)
        self.diagnosis = diagnosis


@dataclass(frozen=True, slots=True, eq=False)
class TickView:
    """Состояние отсчёта, общее для всех клиентов: строится один раз на отсчёт.

    Метки компонент и списки видимых аппаратов не зависят от того, какой клиент
    диагностируется, а их вычисление — самая дорогая часть диагностики. При разборе
    перерывов клиентов на одном отсчёте бывает несколько, поэтому общая часть вынесена
    сюда (`04_CORE.md` §2, шаг 7).
    """

    plan: ContactPlan
    tick: int
    labels: tuple[int, ...]
    dense_component: dict[int, int]
    available_gateways: tuple[str, ...]
    gateway_visible_satellites: tuple[str, ...]
    failed_satellites: tuple[str, ...]


def failed_satellites(plan: ContactPlan, tick: int) -> tuple[str, ...]:
    """Аппараты в отказе на отсчёте: выведены по очереди запуска, но недоступны.

    Contact plan хранит только итоговую активность, поэтому запущенность восстанавливается
    как «аппарат работал хотя бы на одном отсчёте горизонта»: незапущенный аппарат не
    работает никогда. Аппарат, недоступный весь расчёт, по этим данным неотличим от
    незапущенного и в список не попадает — он и не «отказал рядом с разрывом», а
    отсутствовал в сети с самого начала.
    """
    launched = plan.active.any(axis=0)
    failed = launched & ~plan.active[tick]
    return tuple(plan.nodes[index] for index in np.flatnonzero(failed))


def build_tick_view(plan: ContactPlan, tick: int) -> TickView:
    """Собирает общие для клиентов данные отсчёта."""
    labels = components(plan, tick)
    gateway_nodes = available_gateway_nodes(plan, tick)
    available = tuple(plan.nodes[node] for node in gateway_nodes)
    visible: list[str] = []
    seen: set[str] = set()
    for gateway_id in available:
        for satellite_id in plan.visible_satellites(tick, gateway_id):
            if satellite_id not in seen:
                seen.add(satellite_id)
                visible.append(satellite_id)
    return TickView(
        plan=plan,
        tick=tick,
        labels=tuple(labels),
        dense_component=_dense_component_ids(plan, labels, gateway_nodes),
        available_gateways=available,
        gateway_visible_satellites=tuple(visible),
        failed_satellites=failed_satellites(plan, tick),
    )


def _dense_component_ids(
    plan: ContactPlan, labels: list[int], gateway_nodes: tuple[int, ...]
) -> dict[int, int]:
    """Сквозная нумерация компонент с нуля в порядке узлов: аппараты, затем шлюзы.

    Клиентские пункты пропущены: они не ретранслируют и каждый образует собственную
    компоненту, которая ничего не говорит о структуре сети и только сдвигала бы номера.
    """
    dense: dict[int, int] = {}
    for node in (*range(plan.satellite_count), *gateway_nodes):
        root = labels[node]
        if root not in dense:
            dense[root] = len(dense)
    return dense


def _component_of(view: TickView, satellite_ids: tuple[str, ...]) -> int | None:
    """Номер компоненты первого по порядку узлов аппарата из списка.

    Видимые аппараты одной стороны могут лежать в разных компонентах; интерфейсу нужен
    один номер, и берётся он детерминированно, а проверка разрыва всё равно сравнивает
    полные множества компонент.
    """
    if not satellite_ids:
        return None
    node = min(view.plan.node_index[satellite_id] for satellite_id in satellite_ids)
    return view.dense_component[view.labels[node]]


def _roots(view: TickView, satellite_ids: tuple[str, ...]) -> set[int]:
    return {view.labels[view.plan.node_index[satellite_id]] for satellite_id in satellite_ids}


def triggered_causes(view: TickView, client: str) -> tuple[OutageCause, ...]:
    """Все сработавшие причины в порядке `03_GLOSSARY.md` §3.1.

    `NO_GATEWAY_COVERAGE` проверяется только при наличии доступного шлюза, а
    `NETWORK_PARTITION` — только когда аппараты видят обе стороны: иначе при полном отказе
    шлюзов или пустом небе к настоящей причине добавлялись бы формально верные, но
    бессмысленные для инженера «разрыв межспутниковой сети» и «нет связи со шлюзом».
    """
    client_visible = view.plan.client_visible(view.tick, client)
    gateway_visible = view.gateway_visible_satellites
    causes: list[OutageCause] = []
    if not client_visible:
        causes.append(OutageCause.NO_CLIENT_COVERAGE)
    if not view.available_gateways:
        causes.append(OutageCause.GATEWAY_OUTAGE)
    elif not gateway_visible:
        causes.append(OutageCause.NO_GATEWAY_COVERAGE)
    if (
        client_visible
        and gateway_visible
        and not (_roots(view, client_visible) & _roots(view, gateway_visible))
    ):
        causes.append(OutageCause.NETWORK_PARTITION)
    return tuple(causes)


def _neighbour_path(
    routes: RouteTable, client: str, tick: int, step: int
) -> tuple[str, ...] | None:
    """Ближайший маршрут клиента в сторону `step`: до разрыва или после него."""
    paths = routes.paths[client]
    index = tick + step
    while 0 <= index < routes.ticks:
        path = paths[index]
        if path is not None:
            return tuple(path)
        index += step
    return None


def build_evidence(view: TickView, routes: RouteTable, client: str) -> Evidence:
    """Доказательства к причинам: что видят стороны и какие маршруты были рядом."""
    client_visible = view.plan.client_visible(view.tick, client)
    return Evidence(
        client_visible_satellites=client_visible,
        gateway_visible_satellites=view.gateway_visible_satellites,
        failed_satellites=view.failed_satellites,
        client_component_id=_component_of(view, client_visible),
        gateway_component_id=_component_of(view, view.gateway_visible_satellites),
        last_path=_neighbour_path(routes, client, view.tick, -1),
        next_path=_neighbour_path(routes, client, view.tick, 1),
    )


def diagnose(view: TickView, routes: RouteTable, client: str) -> Diagnosis:
    """Диагноз на готовом состоянии отсчёта; расхождение с маршрутизацией — исключение.

    Проверка двусторонняя. Пути нет, но ни одна причина не сработала — расчёт потерял
    связь с собственными данными. Путь есть, но причина сработала — тем более: каждая
    причина отрицает существование маршрута, и обе ситуации означают ошибку ядра, а не
    разрыв связи (`03_GLOSSARY.md` §3.1, `04_CORE.md` §3.4).
    """
    causes = triggered_causes(view, client)
    evidence = build_evidence(view, routes, client)
    has_path = routes.paths[client][view.tick] is not None
    if has_path and causes:
        diagnosis = Diagnosis(
            primary_cause=OutageCause.INTERNAL_INCONSISTENCY,
            causes=(OutageCause.INTERNAL_INCONSISTENCY, *causes),
            evidence=evidence,
        )
        raise InconsistentDiagnosisError(
            f"маршрут найден, но сработала причина {causes[0]}",
            tick=view.tick,
            client=client,
            diagnosis=diagnosis,
        )
    if not has_path and not causes:
        diagnosis = Diagnosis(
            primary_cause=OutageCause.INTERNAL_INCONSISTENCY,
            causes=(OutageCause.INTERNAL_INCONSISTENCY,),
            evidence=evidence,
        )
        raise InconsistentDiagnosisError(
            "маршрута нет, но ни одна причина не сработала",
            tick=view.tick,
            client=client,
            diagnosis=diagnosis,
        )
    return Diagnosis(
        primary_cause=causes[0] if causes else None, causes=causes, evidence=evidence
    )


def explain(plan: ContactPlan, routes: RouteTable, tick: int, client: str) -> Diagnosis:
    """Причина отсутствия маршрута клиента на отсчёте и доказательства к ней.

    На отсчёте с маршрутом возвращается диагноз без причин: вызывающему коду не нужно
    заранее знать, был ли разрыв.
    """
    return diagnose(build_tick_view(plan, tick), routes, client)
