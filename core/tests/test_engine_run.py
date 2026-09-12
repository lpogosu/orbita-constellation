"""Оркестрация Run и команды `python -m orbita_core`."""

from __future__ import annotations

from pathlib import Path

import pytest

from orbita_core import ENGINE_VERSION, engine
from orbita_core.cli import main
from orbita_core.engine import RunStage
from orbita_core.export import load_export
from orbita_core.routing import InternalInconsistencyError, RoutingPolicy
from orbita_core.scenario import config_hash, load
from tests.support import CROSSCHECK_TIMES_S, FIXTURES_DIR, SCENARIO_PATHS, synthetic_scenario


def test_run_reports_stages_in_the_documented_order() -> None:
    """Стадии идут в порядке `03_GLOSSARY.md` §3.4 и каждая объявляется ровно один раз."""
    events: list[tuple[RunStage, int, int]] = []

    def record(stage: RunStage, completed_ticks: int, total_ticks: int) -> None:
        events.append((stage, completed_ticks, total_ticks))

    result = engine.run(
        synthetic_scenario(), RoutingPolicy.BFS_SHORTEST, progress=record, backup_paths=False
    )
    assert [stage for stage, _, _ in events] == list(RunStage)
    assert {total for _, _, total in events} == {result.routes.ticks}
    completed = [done for _, done, _ in events]
    # Доля посчитанного не убывает: прогресс не имеет права идти назад.
    assert completed == sorted(completed)
    assert completed[-1] == result.routes.ticks


def test_run_accepts_both_a_parsed_scenario_and_raw_json() -> None:
    """Словарь из тела запроса и разобранный сценарий дают один и тот же результат."""
    raw = synthetic_scenario()
    from_raw = engine.run(raw, RoutingPolicy.BFS_SHORTEST, backup_paths=False)
    from_parsed = engine.run(from_raw.scenario, RoutingPolicy.BFS_SHORTEST, backup_paths=False)
    assert from_raw.config_hash == from_parsed.config_hash
    assert from_raw.scenario == from_parsed.scenario


def test_run_carries_its_identity() -> None:
    """Run несёт `config_hash`, `engine_version` и политику (`01_SPEC.md` §7, ADR-011)."""
    scenario = load(SCENARIO_PATHS[0])
    result = engine.run(scenario, RoutingPolicy.PERSISTENT, backup_paths=False)
    assert result.engine_version == ENGINE_VERSION
    assert result.routing_policy is RoutingPolicy.PERSISTENT
    assert result.config_hash == config_hash(scenario, str(RoutingPolicy.PERSISTENT))
    # Политика входит в ключ: тот же сценарий с другой политикой — другой Run.
    other = engine.run(scenario, RoutingPolicy.BFS_SHORTEST, backup_paths=False)
    assert other.config_hash != result.config_hash


def test_run_does_not_swallow_an_internal_inconsistency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Расхождение обхода и Union-Find доходит до вызывающего кода, а не гасится в Run."""

    def failing_route_all(*_: object, **__: object) -> None:
        raise InternalInconsistencyError("подменённый расчёт", tick=0, client="")

    monkeypatch.setattr(engine, "route_all", failing_route_all)
    with pytest.raises(InternalInconsistencyError):
        engine.run(synthetic_scenario(), RoutingPolicy.BFS_SHORTEST)


def test_cli_run_writes_a_loadable_export(tmp_path: Path) -> None:
    """`run --out` пишет файл, который читается обратно без правок."""
    export_path = tmp_path / "result.json"
    scenario_path = SCENARIO_PATHS[0]
    code = main(
        [
            "run",
            str(scenario_path),
            "--policy",
            str(RoutingPolicy.DIJKSTRA_DISTANCE),
            "--out",
            str(export_path),
            "--no-backup-paths",
        ]
    )
    assert code == 0
    loaded = load_export(export_path)
    assert loaded.routing_policy is RoutingPolicy.DIJKSTRA_DISTANCE
    assert loaded.run_id is None
    assert loaded.engine_version == ENGINE_VERSION


def test_cli_validate_separates_good_and_bad_scenarios() -> None:
    """Валидный сценарий даёт 0, файл с ошибками — 1."""
    assert main(["validate", str(SCENARIO_PATHS[0])]) == 0
    assert main(["validate", str(FIXTURES_DIR / "multi_errors.json")]) == 1


def test_cli_crosscheck_matches_the_official_module() -> None:
    """Сверка с `case/geometry/geometry.py` на контрольных отсчётах проходит."""
    ticks = ",".join(str(t_s) for t_s in CROSSCHECK_TIMES_S)
    assert main(["crosscheck", str(SCENARIO_PATHS[0]), "--ticks", ticks]) == 0
