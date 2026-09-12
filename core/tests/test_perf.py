"""Бюджет времени полного расчёта (`04_CORE.md` §2).

Сценарий выбирается по числу аппаратов в самом файле: привязка к имени рассыпалась бы,
как только каталог пополнится, а бюджет задан именно размером группировки.
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any, Final

from orbita_core import engine
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import load
from tests.support import SCENARIO_PATHS

# Бюджет карточки M1-D: полный расчёт крупнейшего сценария каталога.
RUN_BUDGET_S: Final[float] = 0.5
# Три прогона и медиана: одиночный замер на ноутбуке ловит паузы сборщика и планировщика.
REPEATS: Final[int] = 3


def _satellite_count(path: Path) -> int:
    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    satellites: list[object] = raw["design"]["satellites"]
    return len(satellites)


def _largest_scenario() -> Path:
    # При равном числе аппаратов берётся первый по имени: выбор обязан быть однозначным.
    return min(SCENARIO_PATHS, key=lambda path: (-_satellite_count(path), path.name))


def test_largest_scenario_fits_the_budget() -> None:
    """Полный расчёт вместе с резервными путями укладывается в бюджет."""
    scenario = load(_largest_scenario())
    durations: list[float] = []
    for _ in range(REPEATS):
        started = time.perf_counter()
        result = engine.run(scenario, RoutingPolicy.BFS_SHORTEST, backup_paths=True)
        durations.append(time.perf_counter() - started)
        # Расчёт обязан быть полным: пустой результат уложился бы в любой бюджет.
        assert result.aggregate.config.backup_path_count_min is not None
        assert result.routes.ticks == scenario.ticks
    median_s = statistics.median(durations)
    assert median_s < RUN_BUDGET_S, f"медиана {median_s:.3f} с при бюджете {RUN_BUDGET_S} с"


def test_reported_duration_matches_the_measured_one() -> None:
    """`duration_ms` описывает сам расчёт, а не время с начала процесса."""
    scenario = load(_largest_scenario())
    started = time.perf_counter()
    result = engine.run(scenario, RoutingPolicy.BFS_SHORTEST, backup_paths=False)
    measured_ms = (time.perf_counter() - started) * 1000
    assert 0 < result.duration_ms <= measured_ms + 1
