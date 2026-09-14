"""Устойчивость: сценарий отказов против штатного и рейтинг критичных аппаратов.

Запуск: `python docs/analysis/resilience_analysis.py`. Результат —
`results/resilience.json`.

Две части. Первая — поотсчётное сравнение сценария 03 (десять аппаратов недоступны с
шестого часа) со сценарием 01 средствами `orbita_core.compare`: какие направления
затронуты, сколько отсчётов маршрут уцелел узел в узел, сколько был перестроен обходом.
Вторая — контрфактический прогон `orbita_core.resilience.criticality`: каждому из 48
аппаратов по очереди назначается отказ на весь горизонт, и сутки считаются заново.
"""

from __future__ import annotations

from typing import Final

import common
from orbita_core import compare, resilience
from orbita_core.metrics import OutageInterval

# Сколько аппаратов рейтинга выписывается в отчёт целиком. Полный список остаётся в JSON,
# в документ идёт голова: у хвоста дельты нулевые и различать их нечем.
TOP_COUNT: Final[int] = 10


def client_outages(outages: list[OutageInterval], client_id: str) -> list[OutageInterval]:
    return [item for item in outages if item.client_id == client_id]


def compare_scenarios() -> dict[str, object]:
    """Сценарий 03 против 01: что изменилось у каждого клиента."""
    policy = common.DEFAULT_POLICY
    base = common.run(common.parse(common.load_dict("01_full_constellation")), policy)
    other = common.run(common.parse(common.load_dict("03_satellite_outages")), policy)
    step_s = base.plan.step_s

    base_availability = {item.client_id: item.availability for item in base.aggregate.clients}
    base_gap = {item.client_id: item.max_gap_s for item in base.aggregate.clients}
    clients: list[dict[str, object]] = []
    for item in other.aggregate.clients:
        base_paths = base.routes.paths[item.client_id]
        other_paths = other.routes.paths[item.client_id]
        view = compare.compare_client(
            item.client_id,
            base_paths=base_paths,
            other_paths=other_paths,
            base_outages=client_outages(base.aggregate.outages, item.client_id),
            other_outages=client_outages(other.aggregate.outages, item.client_id),
            step_s=step_s,
        )
        added = sum(
            1 for change in view.outage_diff if change.kind is compare.OutageChangeKind.ADDED
        )
        clients.append(
            {
                "client_id": item.client_id,
                "affected": view.affected,
                "availability_before": base_availability[item.client_id],
                "availability_after": item.availability,
                "availability_delta": item.availability - base_availability[item.client_id],
                "max_gap_before_s": base_gap[item.client_id],
                "max_gap_after_s": item.max_gap_s,
                "max_gap_delta_s": item.max_gap_s - base_gap[item.client_id],
                "route_kept_ticks": view.route_kept_ticks,
                "route_rebuilt_ticks": view.route_rebuilt_ticks,
                "first_divergence_t_s": view.first_divergence_t_s,
                "first_new_outage_t_s": view.first_new_outage_t_s,
                "outage_changes_total": len(view.outage_diff),
                "outage_changes_added": added,
                "max_hops_after": item.max_hops,
            }
        )
    return {
        "base": "01_full_constellation",
        "other": "03_satellite_outages",
        "clients": clients,
        "max_hops_before": base.aggregate.config.max_hops,
        "max_hops_after": other.aggregate.config.max_hops,
    }


def criticality_ranking() -> dict[str, object]:
    """Отказ каждого аппарата по одному: 48 контрфактических прогонов."""
    scenario = common.parse(common.load_dict("01_full_constellation"))
    report = resilience.criticality(scenario, common.DEFAULT_POLICY)
    satellites = [
        {
            "satellite_id": entry.satellite_id,
            "plane_id": entry.plane_id,
            "delta_min_client_availability": entry.delta_min_client_availability,
            "delta_worst_max_gap_s": entry.delta_worst_max_gap_s,
            "affected_clients": list(entry.affected_clients),
            "min_cut_frequency": entry.min_cut_frequency,
            "articulation_frequency": entry.articulation_frequency,
        }
        for entry in report.satellites
    ]
    harmful = [item for item in satellites if item["delta_min_client_availability"] != 0.0]
    return {
        "base_min_client_availability": report.base.min_client_availability,
        "base_worst_max_gap_s": report.base.worst_max_gap_s,
        "satellite_count": len(satellites),
        "harmful_count": len(harmful),
        "top": satellites[:TOP_COUNT],
        "all": satellites,
        "duration_ms": report.duration_ms,
    }


def main() -> None:
    path = common.write_json(
        "resilience",
        {
            "description": (
                "Сценарий отказов против штатного и контрфактический прогон по каждому "
                "аппарату, политика bfs_shortest"
            ),
            "outage_scenario": compare_scenarios(),
            "criticality": criticality_ranking(),
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
