"""Причины разрыва, доказательства и обе проверки согласованности (ADR-005).

Топология каждого сценария собирается вручную, а не подбирается орбитальной геометрией:
причина разрыва зависит только от того, какие линии существуют на отсчёте, и заданный
граф делает проверку однозначной. Идентификаторы узлов синтетические (ADR-015).
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from orbita_core.contacts import ContactPlan
from orbita_core.diagnosis import (
    InconsistentDiagnosisError,
    OutageCause,
    explain,
    failed_satellites,
)
from orbita_core.routing import InternalInconsistencyError, RouteTable, RoutingPolicy, route_all
from tests.support import scripted_plan

CLIENT = "TRM-0"
GATEWAY = "GW-0"

# Цепочка «клиент — SAT-00 — SAT-01 — SAT-02 — шлюз»: единственный маршрут, поэтому любая
# снятая линия даёт ровно одну причину разрыва.
CHAIN_LINKS: tuple[tuple[int, int, float], ...] = (
    (0, 1, 500.0),  # ISL SAT-00 — SAT-01
    (1, 2, 500.0),  # ISL SAT-01 — SAT-02
    (0, 4, 800.0),  # клиент TRM-0 — SAT-00
    (2, 3, 900.0),  # шлюз GW-0 — SAT-02
)

ALL_LINKS = (True, True, True, True)
NO_CLIENT_LINK = (True, True, False, True)
NO_GATEWAY_LINK = (True, True, True, False)
BROKEN_ISL = (True, False, True, True)


def _chain_plan(
    present: tuple[tuple[bool, ...], ...], gateway_available: tuple[bool, ...]
) -> ContactPlan:
    return scripted_plan(
        satellite_count=3,
        gateway_count=1,
        client_count=1,
        links=CHAIN_LINKS,
        present=present,
        gateway_available=[[value] for value in gateway_available],
    )


def _routes(plan: ContactPlan) -> RouteTable:
    return route_all(plan, RoutingPolicy.BFS_SHORTEST)


def test_no_client_coverage() -> None:
    plan = _chain_plan((ALL_LINKS, NO_CLIENT_LINK), (True, True))
    diagnosis = explain(plan, _routes(plan), 1, CLIENT)
    assert diagnosis.primary_cause is OutageCause.NO_CLIENT_COVERAGE
    assert diagnosis.causes == (OutageCause.NO_CLIENT_COVERAGE,)
    assert diagnosis.evidence.client_visible_satellites == ()
    assert diagnosis.evidence.client_component_id is None
    # Шлюз продолжает видеть свой аппарат: разрыв только со стороны клиента.
    assert diagnosis.evidence.gateway_visible_satellites == ("SAT-02",)
    assert diagnosis.evidence.gateway_component_id is not None


def test_gateway_outage() -> None:
    plan = _chain_plan((ALL_LINKS, ALL_LINKS), (True, False))
    diagnosis = explain(plan, _routes(plan), 1, CLIENT)
    assert diagnosis.primary_cause is OutageCause.GATEWAY_OUTAGE
    # Недоступный шлюз перестаёт быть узлом графа, поэтому видимых ему аппаратов нет, но
    # причина остаётся одна: отсутствие связи со шлюзом здесь ничего не объясняет.
    assert diagnosis.causes == (OutageCause.GATEWAY_OUTAGE,)
    assert diagnosis.evidence.client_visible_satellites == ("SAT-00",)


def test_no_gateway_coverage() -> None:
    plan = _chain_plan((ALL_LINKS, NO_GATEWAY_LINK), (True, True))
    diagnosis = explain(plan, _routes(plan), 1, CLIENT)
    assert diagnosis.primary_cause is OutageCause.NO_GATEWAY_COVERAGE
    assert diagnosis.causes == (OutageCause.NO_GATEWAY_COVERAGE,)
    assert diagnosis.evidence.gateway_visible_satellites == ()
    assert diagnosis.evidence.gateway_component_id is None


def test_network_partition() -> None:
    plan = _chain_plan((ALL_LINKS, BROKEN_ISL), (True, True))
    diagnosis = explain(plan, _routes(plan), 1, CLIENT)
    assert diagnosis.primary_cause is OutageCause.NETWORK_PARTITION
    assert diagnosis.causes == (OutageCause.NETWORK_PARTITION,)
    evidence = diagnosis.evidence
    assert evidence.client_visible_satellites == ("SAT-00",)
    assert evidence.gateway_visible_satellites == ("SAT-02",)
    assert evidence.client_component_id != evidence.gateway_component_id


def test_internal_inconsistency_when_route_table_hides_existing_path() -> None:
    """Маршрут в графе есть, а таблица его не содержит: причины нет, расчёт ошибочен."""
    plan = _chain_plan((ALL_LINKS, ALL_LINKS), (True, True))
    routes = _routes(plan)
    broken = replace(routes, paths={CLIENT: [routes.paths[CLIENT][0], None]})
    with pytest.raises(InconsistentDiagnosisError) as error:
        explain(plan, broken, 1, CLIENT)
    assert error.value.diagnosis.primary_cause is OutageCause.INTERNAL_INCONSISTENCY
    assert error.value.diagnosis.causes == (OutageCause.INTERNAL_INCONSISTENCY,)
    assert error.value.tick == 1
    assert error.value.client == CLIENT
    # Ошибка расчёта ловится тем же типом, что и расхождение BFS с Union-Find.
    assert isinstance(error.value, InternalInconsistencyError)


def test_internal_inconsistency_when_cause_fires_with_path() -> None:
    """Таблица утверждает маршрут там, где клиент никого не видит: тоже ошибка расчёта."""
    plan = _chain_plan((ALL_LINKS, NO_CLIENT_LINK), (True, True))
    routes = _routes(plan)
    invented = [CLIENT, "SAT-00", "SAT-01", "SAT-02", GATEWAY]
    broken = replace(routes, paths={CLIENT: [routes.paths[CLIENT][0], invented]})
    with pytest.raises(InconsistentDiagnosisError) as error:
        explain(plan, broken, 1, CLIENT)
    assert error.value.diagnosis.primary_cause is OutageCause.INTERNAL_INCONSISTENCY
    assert OutageCause.NO_CLIENT_COVERAGE in error.value.diagnosis.causes


def test_several_causes_ordered_by_glossary() -> None:
    """Клиент никого не видит и шлюз недоступен: обе причины, основная — первая в таблице."""
    plan = _chain_plan((ALL_LINKS, NO_CLIENT_LINK), (True, False))
    diagnosis = explain(plan, _routes(plan), 1, CLIENT)
    assert diagnosis.causes == (OutageCause.NO_CLIENT_COVERAGE, OutageCause.GATEWAY_OUTAGE)
    assert diagnosis.primary_cause is OutageCause.NO_CLIENT_COVERAGE


def test_tick_with_path_has_no_cause() -> None:
    plan = _chain_plan((ALL_LINKS,), (True,))
    diagnosis = explain(plan, _routes(plan), 0, CLIENT)
    assert diagnosis.primary_cause is None
    assert diagnosis.causes == ()


def test_last_and_next_path_span_the_whole_outage() -> None:
    """Маршруты по краям берутся за пределами разрыва, а не с соседнего отсчёта разрыва."""
    plan = _chain_plan((ALL_LINKS, NO_CLIENT_LINK, NO_CLIENT_LINK, ALL_LINKS), (True,) * 4)
    routes = _routes(plan)
    expected = (CLIENT, "SAT-00", "SAT-01", "SAT-02", GATEWAY)
    for tick in (1, 2):
        evidence = explain(plan, routes, tick, CLIENT).evidence
        assert evidence.last_path == expected
        assert evidence.next_path == expected


def test_edge_outage_has_no_neighbour_paths() -> None:
    plan = _chain_plan((NO_CLIENT_LINK, ALL_LINKS, NO_CLIENT_LINK), (True, True, True))
    routes = _routes(plan)
    assert explain(plan, routes, 0, CLIENT).evidence.last_path is None
    assert explain(plan, routes, 2, CLIENT).evidence.next_path is None


def test_failed_satellites_list_launched_but_unavailable() -> None:
    """Отказавший аппарат попадает в доказательства, незапущенный — нет."""
    plan = scripted_plan(
        satellite_count=3,
        gateway_count=1,
        client_count=1,
        links=CHAIN_LINKS,
        present=(ALL_LINKS, ALL_LINKS),
        gateway_available=[[True], [True]],
        # SAT-01 отказывает на втором отсчёте, SAT-02 не выведен ни разу.
        active=((True, True, False), (True, False, False)),
    )
    assert failed_satellites(plan, 0) == ()
    assert failed_satellites(plan, 1) == ("SAT-01",)
    diagnosis = explain(plan, _routes(plan), 1, CLIENT)
    assert diagnosis.evidence.failed_satellites == ("SAT-01",)
