"""Замер полного расчёта, запускаемый отдельным процессом из `test_perf.py`.

Модуль не содержит тестов и вызывается как `python -m tests.perf_probe <сценарий> <N>`:
печатает в stdout JSON с временем прогонов и с признаками того, что расчёт был полным.
Разбирает этот вывод `test_perf.py`, там же объяснено, зачем нужен отдельный процесс.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Final

from orbita_core import engine
from orbita_core.engine import RunResult
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import Scenario, load

# Первый расчёт в процессе оплачивает подгрузку модулей NumPy и прогрев кэшей: в чистом
# клоне он идёт заметно дольше остальных и измеряет окружение, а не ядро.
WARMUP_RUNS: Final[int] = 1


def _run(scenario: Scenario) -> tuple[float, RunResult]:
    """Один полный расчёт вместе с резервными путями и время по секундомеру."""
    started = time.perf_counter()
    result = engine.run(scenario, RoutingPolicy.BFS_SHORTEST, backup_paths=True)
    return time.perf_counter() - started, result


def measure(scenario_path: Path, repeats: int) -> dict[str, object]:
    """Прогревочные расчёты, затем `repeats` замеров одного и того же сценария."""
    scenario = load(scenario_path)
    for _ in range(WARMUP_RUNS):
        _run(scenario)
    runs = [_run(scenario) for _ in range(repeats)]
    last = runs[-1][1]
    return {
        "runs": [[elapsed_s, result.duration_ms] for elapsed_s, result in runs],
        # Полноту расчёта проверяет вызывающий тест: пустой результат уложился бы в любой
        # бюджет, поэтому замер обязан приносить и то, что посчиталось.
        "backup_path_count_min": last.aggregate.config.backup_path_count_min,
        "ticks": last.routes.ticks,
    }


def main(argv: list[str]) -> int:
    scenario_path, repeats = Path(argv[0]), int(argv[1])
    print(json.dumps(measure(scenario_path, repeats)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
