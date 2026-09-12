"""Политики маршрутизации на сценарии 01: что меняется, кроме самих маршрутов.

Запуск: `python docs/analysis/policies.py`. Результат — `results/policies.json`.

Три политики ядра считаются на одном и том же плане контактов, поэтому различаться они
могут только выбором маршрута среди существующих. Достижимость от выбора не зависит —
это проверяется числом, а не утверждается: если доступность разошлась, значит, разошлась
и связность, и дальше сравнивать нечего.
"""

from __future__ import annotations

import common
from orbita_core import compare
from orbita_core.routing import RoutingPolicy


def main() -> None:
    scenario = common.parse(common.load_dict("01_full_constellation"))
    results = {
        policy: common.run(scenario, policy)
        for policy in (
            RoutingPolicy.BFS_SHORTEST,
            RoutingPolicy.PERSISTENT,
            RoutingPolicy.DIJKSTRA_DISTANCE,
        )
    }
    reference = results[RoutingPolicy.BFS_SHORTEST]

    policies: dict[str, object] = {}
    for policy, result in results.items():
        step_s = result.plan.step_s
        clients = [
            {
                "client_id": item.client_id,
                "availability": item.availability,
                "max_gap_s": item.max_gap_s,
                "mean_hops": item.mean_hops,
                "max_hops": item.max_hops,
                "route_switches": item.route_switches,
                # Сколько отсчётов маршрут совпал с маршрутом опорной политики узел в
                # узел: доступность у политик одинаковая, и вся разница видна только здесь.
                "ticks_same_as_bfs": compare.compare_routes(
                    reference.routes.paths[item.client_id],
                    result.routes.paths[item.client_id],
                    step_s,
                ).route_kept_ticks,
                # Число переходов на каждом отсчёте против опорной политики: среднее по
                # суткам могло бы совпасть у политик, которые расходятся в обе стороны.
                "ticks_with_more_hops": sum(
                    1
                    for before, after in zip(
                        reference.routes.hops[item.client_id],
                        result.routes.hops[item.client_id],
                        strict=True,
                    )
                    if before is not None and after is not None and after > before
                ),
                "ticks_with_fewer_hops": sum(
                    1
                    for before, after in zip(
                        reference.routes.hops[item.client_id],
                        result.routes.hops[item.client_id],
                        strict=True,
                    )
                    if before is not None and after is not None and after < before
                ),
            }
            for item in result.aggregate.clients
        ]
        policies[str(policy)] = {
            "clients": clients,
            "config": common.config_summary(result),
            "duration_ms": result.duration_ms,
        }

    path = common.write_json(
        "policies",
        {
            "description": "Три политики маршрутизации на сценарии 01, сетка 86400 с / 120 с",
            "reference_policy": str(RoutingPolicy.BFS_SHORTEST),
            "ticks": reference.plan.ticks,
            "policies": policies,
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
