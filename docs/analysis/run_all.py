"""Все расчёты анализа одной командой: `python docs/analysis/run_all.py`.

Порядок важен: `recommendation` читает лучшую точку из результата `sweep_config`.
Полный прогон занимает около пяти минут на одном ядре.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Final

import baseline
import deployment
import failure_depth
import improvements
import isl_range
import policies
import recommendation
import resilience_analysis
import sweep_config

STEPS: Final[tuple[tuple[str, Callable[[], None]], ...]] = (
    ("baseline", baseline.main),
    ("deployment", deployment.main),
    ("isl_range", isl_range.main),
    ("resilience_analysis", resilience_analysis.main),
    ("failure_depth", failure_depth.main),
    ("sweep_config", sweep_config.main),
    ("recommendation", recommendation.main),
    ("policies", policies.main),
    ("improvements", improvements.main),
)


def main() -> None:
    for name, step in STEPS:
        started = time.perf_counter()
        step()
        print(f"{name}: {time.perf_counter() - started:.1f} с")


if __name__ == "__main__":
    main()
