"""Бюджет времени полного расчёта (`04_CORE.md` §2).

Сценарий выбирается по числу аппаратов в самом файле: привязка к имени рассыпалась бы,
как только каталог пополнится, а бюджет задан именно размером группировки.

Замер идёт в отдельном процессе (`tests/perf_probe.py`). Причина измерена: один и тот же
расчёт в процессе pytest, отработавшем несколько сотен тестов, стабильно идёт в 2,5 раза
дольше, чем в свежем процессе в ту же секунду (0,5 с против 0,21 с), — и повторами этого
не снять, замедление держится на всей серии. Бюджет описывает стоимость расчёта в том
виде, в каком его запускают CLI и воркер: в своём процессе. Порядок и состав тестов на
результат больше не влияют, а сам бюджет остаётся жёстким.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Final

from orbita_core import engine
from orbita_core.routing import RoutingPolicy
from orbita_core.scenario import load
from tests.support import SCENARIO_PATHS

# Бюджет карточки M1-D: полный расчёт крупнейшего сценария каталога.
RUN_BUDGET_S: Final[float] = 0.5
# Три замера подряд: одиночный прогон целиком зависит от того, чем в эту секунду занята
# машина, и на общем CI это заметно сильнее, чем на ноутбуке.
REPEATS: Final[int] = 3
# Расчёт с прогревом укладывается в секунды; минуты означают, что ядро зациклилось, и
# ждать их незачем — тест должен упасть, а не висеть.
PROBE_TIMEOUT_S: Final[float] = 120.0


def _satellite_count(path: Path) -> int:
    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    satellites: list[object] = raw["design"]["satellites"]
    return len(satellites)


def _largest_scenario() -> Path:
    # При равном числе аппаратов берётся первый по имени: выбор обязан быть однозначным.
    return min(SCENARIO_PATHS, key=lambda path: (-_satellite_count(path), path.name))


def _measure(scenario_path: Path) -> dict[str, Any]:
    """Запускает замер отдельным процессом и возвращает разобранный отчёт."""
    # `-m tests.perf_probe` с рабочим каталогом пакета: так дочерний процесс находит и
    # `tests`, и установленный `orbita_core`, не полагаясь на каталог запуска pytest.
    probe = subprocess.run(
        [sys.executable, "-m", "tests.perf_probe", str(scenario_path), str(REPEATS)],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=PROBE_TIMEOUT_S,
        check=False,
    )
    assert probe.returncode == 0, f"замер не выполнился: {probe.stderr.strip()}"
    report: dict[str, Any] = json.loads(probe.stdout)
    return report


def test_largest_scenario_fits_the_budget() -> None:
    """Полный расчёт вместе с резервными путями укладывается в бюджет."""
    scenario_path = _largest_scenario()
    report = _measure(scenario_path)
    # Расчёт обязан быть полным: пустой результат уложился бы в любой бюджет.
    assert report["backup_path_count_min"] is not None
    assert report["ticks"] == load(scenario_path).ticks

    runs: list[list[float]] = report["runs"]
    # Минимум, а не медиана: посторонняя нагрузка, сборщик мусора и планировщик умеют
    # только добавлять время, поэтому лучший из замеров ближе всего к собственной
    # стоимости расчёта. Строгость теста от этого не страдает: расчёт, который перестал
    # укладываться в бюджет, не уложится в него ни в одном из прогонов.
    fastest_s = min(elapsed_s for elapsed_s, _ in runs)
    assert fastest_s < RUN_BUDGET_S, f"лучший замер {fastest_s:.3f} с при бюджете {RUN_BUDGET_S} с"
    # Тем же бюджетом проверяется и `duration_ms`: именно это число уходит в экспорт и в
    # отчёты, и разойтись с секундомером теста оно не имеет права.
    fastest_ms = min(duration_ms for _, duration_ms in runs)
    budget_ms = RUN_BUDGET_S * 1000
    assert fastest_ms < budget_ms, f"лучший duration_ms {fastest_ms} при бюджете {budget_ms:.0f} мс"


def test_reported_duration_matches_the_measured_one() -> None:
    """`duration_ms` описывает сам расчёт, а не время с начала процесса."""
    scenario = load(_largest_scenario())
    started = time.perf_counter()
    result = engine.run(scenario, RoutingPolicy.BFS_SHORTEST, backup_paths=False)
    measured_ms = (time.perf_counter() - started) * 1000
    assert 0 < result.duration_ms <= measured_ms + 1
