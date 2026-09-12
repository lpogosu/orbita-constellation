"""Этап развёртывания: одна и та же группировка при launch_stage 1, 2 и 3.

Запуск: `python docs/analysis/deployment.py`. Результат — `results/deployment.json`.

Меняется единственный параметр `design.launch_stage`, всё остальное берётся из
`scenarios/01_full_constellation.json`. Рядом с доступностью считается видимость шлюза:
она общая для всех клиентов и объясняет, почему первая очередь ограничена не только
клиентской видимостью.
"""

from __future__ import annotations

import common
from orbita_core.scenario import LAUNCH_STAGES


def main() -> None:
    base = common.load_dict("01_full_constellation")
    stages: dict[str, object] = {}
    for stage in LAUNCH_STAGES:
        draft = common.load_dict("01_full_constellation")
        design = draft["design"]
        if not isinstance(design, dict):
            raise TypeError("design сценария не является объектом")
        design["launch_stage"] = stage
        scenario = common.parse(draft)
        result = common.run(scenario, common.DEFAULT_POLICY)
        summary = common.run_summary(scenario, with_causes=True)
        summary["deployed_satellite_count"] = sum(
            1 for item in scenario.satellites if item.launch_batch <= stage
        )
        summary["planes_in_use"] = sorted(
            {
                item.plane_id
                for item in scenario.satellites
                if item.launch_batch <= stage
            }
        )
        summary["gateway_visibility"] = {
            gateway: common.site_visibility(result.plan, gateway)
            for gateway in scenario.gateway_ids
        }
        stages[str(stage)] = summary

    path = common.write_json(
        "deployment",
        {
            "description": (
                "Этапы развёртывания 1/2/3 на проекте 01_full_constellation, "
                "политика bfs_shortest"
            ),
            "base_scenario": base["meta"],
            "stages": stages,
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
