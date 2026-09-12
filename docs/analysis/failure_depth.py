"""Глубина отказа: сколько аппаратов группировка теряет, не роняя цель 90 %.

Запуск: `python docs/analysis/failure_depth.py`. Результат — `results/failure_depth.json`.

Рейтинг критичности отвечает на вопрос про один аппарат. Здесь считается запас по числу
одновременных отказов, и считается он с двух сторон:

* **худший случай** — жадный поиск: на каждом шаге к уже отказавшим добавляется аппарат,
  после отказа которого доступность худшего клиента падает сильнее всего. Жадность даёт
  оценку сверху на устойчивость (истинно худший набор может быть ещё хуже), поэтому
  вывод «до k отказов цель держится» из неё делать нельзя — только «после k уже нет»;
* **типичный случай** — случайные наборы отказавших аппаратов с фиксированным зерном.
  Медиана по наборам показывает, что будет при отказах, не подобранных противником.

Отказ назначается на весь горизонт с нулевого отсчёта: это более тяжёлое условие, чем в
сценарии 03, где аппараты выбывают с шестого часа.
"""

from __future__ import annotations

import random
import statistics
from collections.abc import Sequence
from typing import Final

import common

# Жадный поиск дороже случайного, а интерес представляет окрестность порога: базовый запас
# над целью — 6,7 процентного пункта, один отказ стоит около двух.
GREEDY_DEPTH: Final[int] = 6
RANDOM_DEPTH: Final[int] = 10
RANDOM_DRAWS: Final[int] = 20
RANDOM_SEED: Final[int] = 20260401

TARGET: Final[float] = 0.9


def with_failures(
    base: dict[str, object], failed: Sequence[str], horizon_s: int
) -> dict[str, object]:
    """Копия сценария, в которой перечисленные аппараты недоступны весь горизонт."""
    draft = dict(base)
    draft["failures"] = [
        {"satellite_id": satellite_id, "start_s": 0, "end_s": horizon_s}
        for satellite_id in failed
    ]
    return draft


def min_availability(base: dict[str, object], failed: Sequence[str], horizon_s: int) -> float:
    result = common.run(common.parse(with_failures(base, failed, horizon_s)), common.DEFAULT_POLICY)
    return result.aggregate.config.min_client_availability


def greedy_worst_case(
    base: dict[str, object], satellite_ids: Sequence[str], horizon_s: int
) -> list[dict[str, object]]:
    """Наборы отказавших аппаратов, подобранные жадно по падению худшей доступности."""
    chosen: list[str] = []
    remaining = list(satellite_ids)
    steps: list[dict[str, object]] = []
    for _ in range(GREEDY_DEPTH):
        scored = [
            (min_availability(base, [*chosen, candidate], horizon_s), candidate)
            for candidate in remaining
        ]
        value, candidate = min(scored)
        chosen.append(candidate)
        remaining.remove(candidate)
        steps.append(
            {
                "failed_count": len(chosen),
                "failed": list(chosen),
                "added": candidate,
                "min_client_availability": value,
                "target_met": value >= TARGET,
            }
        )
    return steps


def random_draws(
    base: dict[str, object], satellite_ids: Sequence[str], horizon_s: int
) -> list[dict[str, object]]:
    """Случайные наборы отказов: медиана и худший из наблюдённых по каждой глубине."""
    rng = random.Random(RANDOM_SEED)
    rows: list[dict[str, object]] = []
    for count in range(1, RANDOM_DEPTH + 1):
        values = [
            min_availability(base, rng.sample(list(satellite_ids), count), horizon_s)
            for _ in range(RANDOM_DRAWS)
        ]
        rows.append(
            {
                "failed_count": count,
                "draws": RANDOM_DRAWS,
                "median_min_availability": statistics.median(values),
                "worst_min_availability": min(values),
                "best_min_availability": max(values),
                "draws_meeting_target": sum(1 for value in values if value >= TARGET),
            }
        )
    return rows


def main() -> None:
    base = common.load_dict("01_full_constellation")
    scenario = common.parse(base)
    satellite_ids = [item.id for item in scenario.satellites]
    horizon_s = scenario.environment.horizon_s

    path = common.write_json(
        "failure_depth",
        {
            "description": (
                "Одновременные отказы на полной группировке: жадный худший случай и "
                "случайные наборы, политика bfs_shortest"
            ),
            "target_availability": TARGET,
            "base_min_client_availability": min_availability(base, (), horizon_s),
            "greedy_worst_case": greedy_worst_case(base, satellite_ids, horizon_s),
            "random": random_draws(base, satellite_ids, horizon_s),
            "random_seed": RANDOM_SEED,
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
