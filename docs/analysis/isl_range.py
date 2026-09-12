"""Дальность межспутниковой линии: от чего зависит доступность полной группировки.

Запуск: `python docs/analysis/isl_range.py`. Результат — `results/isl_range.json`.

Кейс задаёт две точки — 3000 км (сценарий 01) и 2000 км (сценарий 04). Между ними
считается ещё несколько значений: одна пара точек показывает, что стало хуже, но не
показывает, где именно проходит граница и насколько запас в 3000 км велик.
"""

from __future__ import annotations

import math
from typing import Final

import common
from orbita_core.geometry import EARTH_RADIUS_KM
from orbita_core.scenario import Scenario

RANGES_KM: Final[tuple[float, ...]] = (
    1500.0,
    1750.0,
    2000.0,
    2250.0,
    2500.0,
    # Между 2500 и 2750 км доступность меняется скачком, поэтому шаг здесь мельче:
    # порог связности межспутниковой сети надо назвать числом, а не интервалом.
    2550.0,
    2600.0,
    2650.0,
    2700.0,
    2750.0,
    3000.0,
    3500.0,
    4000.0,
)


def in_plane_neighbour_chord_km(scenario: Scenario) -> float:
    """Расстояние между соседними аппаратами одной плоскости.

    Аппараты плоскости расставлены по слотам равномерно и лежат на одной окружности
    радиуса `R + h`, поэтому расстояние между соседями не зависит от времени и считается
    хордой: именно оно задаёт порог, ниже которого внутриплоскостное кольцо рвётся.
    """
    slots = sorted({item.slot_deg for item in scenario.satellites if item.plane_id == "P1"})
    if len(slots) < 2:
        raise ValueError("в плоскости меньше двух аппаратов")
    spacing_deg = slots[1] - slots[0]
    radius_km = EARTH_RADIUS_KM + scenario.environment.altitude_km
    return 2.0 * radius_km * math.sin(math.radians(spacing_deg) / 2.0)


def main() -> None:
    points: list[dict[str, object]] = []
    for value in RANGES_KM:
        draft = common.load_dict("01_full_constellation")
        environment = draft["environment"]
        if not isinstance(environment, dict):
            raise TypeError("environment сценария не является объектом")
        environment["isl_range_km"] = value
        scenario = common.parse(draft)
        summary = common.run_summary(scenario, with_causes=True)
        summary["isl_range_km"] = value
        points.append(summary)

    path = common.write_json(
        "isl_range",
        {
            "description": (
                "Полная группировка при дальности ISL от 1500 до 4000 км, "
                "политика bfs_shortest"
            ),
            "in_plane_neighbour_chord_km": in_plane_neighbour_chord_km(
                common.parse(common.load_dict("01_full_constellation"))
            ),
            "points": points,
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
