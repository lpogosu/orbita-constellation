"""Базовая линия: четыре сценария кейса на одной сетке, политика `bfs_shortest`.

Запуск: `python docs/analysis/baseline.py`. Результат — `results/baseline.json`:
по каждому сценарию клиентские метрики, свёртка конфигурации и распределение отсчётов
без маршрута по причинам.
"""

from __future__ import annotations

import common


def main() -> None:
    scenarios: dict[str, object] = {}
    for name in common.CASE_SCENARIOS:
        scenario = common.parse(common.load_dict(name))
        summary = common.run_summary(scenario, with_causes=True)
        summary["title"] = scenario.meta.get("title", name)
        summary["satellite_count"] = len(scenario.satellites)
        # Аппараты более поздних очередей остаются в файле сценария, но на орбите их ещё
        # нет: в расчёт входят те, чья партия не превышает этап запуска.
        summary["deployed_satellite_count"] = sum(
            1 for item in scenario.satellites if item.launch_batch <= scenario.launch_stage
        )
        summary["launch_stage"] = scenario.launch_stage
        summary["isl_range_km"] = scenario.environment.isl_range_km
        summary["failed_satellites"] = sorted({item.node_id for item in scenario.failures})
        scenarios[name] = summary

    path = common.write_json(
        "baseline",
        {
            "description": "Четыре сценария кейса, политика bfs_shortest, сетка 86400 с / 120 с",
            "causes_order": list(common.all_causes()),
            "scenarios": scenarios,
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
