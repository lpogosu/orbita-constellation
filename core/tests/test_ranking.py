"""Порядок сравнения конфигураций и рекомендация (ADR-006).

Метрики задаются прямо, без расчёта: ранжирование обязано зависеть только от чисел в
`ConfigMetrics`, и подмена их синтетическими значениями проверяет именно правило выбора.
"""

from __future__ import annotations

import pytest

from orbita_core.metrics import ClientMetrics, ConfigMetrics
from orbita_core.ranking import (
    RANKING_ORDER,
    Candidate,
    Recommendation,
    RunConditions,
    rank,
    recommend,
)
from orbita_core.scenario import Environment

CONDITIONS = RunConditions(
    step_s=120,
    horizon_s=86400,
    isl_range_km=3000.0,
    min_elevation_deg=10.0,
    target_availability=0.9,
)


def _config(
    *,
    min_client_availability: float = 0.9,
    mean_client_availability: float = 0.9,
    worst_max_gap_s: int = 600,
    mean_hops: float | None = 3.0,
    max_hops: int | None = 5,
    route_switches_total: int = 400,
    backup_path_count_min: int | None = 2,
) -> ConfigMetrics:
    return ConfigMetrics(
        min_client_availability=min_client_availability,
        mean_client_availability=mean_client_availability,
        worst_max_gap_s=worst_max_gap_s,
        mean_hops=mean_hops,
        max_hops=max_hops,
        route_switches_total=route_switches_total,
        backup_path_count_min=backup_path_count_min,
        outage_count_by_cause={},
        target_met_clients=(),
    )


# Каждый ключ кортежа `04_CORE.md` §6 и конфигурация, ухудшенная ровно по нему: остальные
# показатели остаются нейтральными, поэтому решает именно проверяемый ключ.
WORSE_BY_KEY: tuple[tuple[str, ConfigMetrics], ...] = (
    ("min_client_availability", _config(min_client_availability=0.5)),
    ("worst_max_gap_s", _config(worst_max_gap_s=1200)),
    ("mean_client_availability", _config(mean_client_availability=0.5)),
    ("backup_path_count_min", _config(backup_path_count_min=1)),
    ("route_switches_total", _config(route_switches_total=900)),
    ("mean_hops", _config(mean_hops=4.0)),
)


def _client(client_id: str, availability: float, max_gap_s: int) -> ClientMetrics:
    return ClientMetrics(
        client_id=client_id,
        availability=availability,
        visibility=1.0,
        max_gap_s=max_gap_s,
        mean_hops=3.0,
        max_hops=5,
        route_switches=100,
        target_met=availability >= CONDITIONS.target_availability,
        outage_count_by_cause={},
    )


def _candidate(
    identifier: str,
    *,
    config: ConfigMetrics | None = None,
    clients: tuple[ClientMetrics, ...] = (),
    changed: tuple[dict[str, object], ...] = (),
    conditions: RunConditions = CONDITIONS,
) -> Candidate:
    return Candidate(
        id=identifier,
        config=config if config is not None else _config(),
        clients=clients or (_client("TRM-0", 0.9, 600),),
        conditions=conditions,
        changed_parameters=changed,
    )


def test_every_ranking_key_is_covered_by_a_case() -> None:
    """Порядок сравнения не должен молча обрасти ключом без проверки."""
    assert tuple(metric for metric, _ in WORSE_BY_KEY) == RANKING_ORDER


@pytest.mark.parametrize(("metric", "worse"), WORSE_BY_KEY, ids=[key for key, _ in WORSE_BY_KEY])
def test_each_key_breaks_the_tie_in_its_direction(metric: str, worse: ConfigMetrics) -> None:
    """При равенстве старших показателей решает следующий по порядку."""
    ordered = rank([_candidate("worse", config=worse), _candidate("better")])
    assert [candidate.id for candidate in ordered] == ["better", "worse"]


def test_availability_outweighs_every_other_metric() -> None:
    """Доступность — ключевой показатель: вариант с ней лучше проигрышного по всем прочим."""
    ordered = rank(
        [
            _candidate(
                "tidy",
                config=_config(
                    min_client_availability=0.90,
                    worst_max_gap_s=120,
                    backup_path_count_min=4,
                    route_switches_total=10,
                    mean_hops=2.0,
                ),
            ),
            _candidate(
                "available",
                config=_config(
                    min_client_availability=0.95,
                    worst_max_gap_s=3600,
                    backup_path_count_min=1,
                    route_switches_total=900,
                    mean_hops=4.0,
                ),
            ),
        ]
    )
    assert [candidate.id for candidate in ordered] == ["available", "tidy"]


def test_equal_candidates_keep_input_order() -> None:
    identifiers = ("first", "second", "third")
    ordered = rank([_candidate(identifier) for identifier in identifiers])
    assert tuple(candidate.id for candidate in ordered) == identifiers


def test_missing_backup_count_is_not_an_advantage() -> None:
    """Неизвестное резервирование считается нулевым и не обгоняет посчитанное."""
    unknown = _candidate("unknown", config=_config(backup_path_count_min=None))
    ordered = rank([unknown, _candidate("known")])
    assert [candidate.id for candidate in ordered] == ["known", "unknown"]


def test_candidate_without_any_path_ranks_last() -> None:
    ordered = rank(
        [
            _candidate("empty", config=_config(mean_hops=None, max_hops=None)),
            _candidate("routed", config=_config(mean_hops=9.0)),
        ]
    )
    assert [candidate.id for candidate in ordered] == ["routed", "empty"]


def _recommendation_with_target(reached: bool) -> Recommendation:
    base = _candidate(
        "base",
        clients=(_client("TRM-0", 0.80, 2400), _client("TRM-1", 0.88, 1200)),
        config=_config(
            min_client_availability=0.80, mean_client_availability=0.84, worst_max_gap_s=2400
        ),
    )
    better_availability = 0.92 if reached else 0.86
    candidate = _candidate(
        "shifted",
        clients=(
            _client("TRM-0", better_availability, 960),
            _client("TRM-1", 0.90, 1200),
        ),
        changed=({"path": "design.planes[1].raan_deg", "from": 60.0, "to": 72.0},),
        config=_config(
            min_client_availability=better_availability,
            mean_client_availability=(better_availability + 0.90) / 2,
            worst_max_gap_s=960,
        ),
    )
    return recommend(base, [candidate])


def test_recommendation_reports_deltas_of_the_best_candidate() -> None:
    recommendation = _recommendation_with_target(reached=True)
    assert recommendation.base_run_id == "base"
    assert recommendation.recommended_run_id == "shifted"
    assert recommendation.ranking_order == RANKING_ORDER
    assert recommendation.changed_parameters[0]["path"] == "design.planes[1].raan_deg"
    assert recommendation.deltas["min_client_availability"] == pytest.approx(0.12)
    assert recommendation.deltas["worst_max_gap_s"] == pytest.approx(-1440)
    per_client = {item.client_id: item for item in recommendation.per_client}
    assert per_client["TRM-0"].availability_delta == pytest.approx(0.12)
    assert per_client["TRM-0"].max_gap_delta_s == -1440
    assert per_client["TRM-1"].availability_delta == pytest.approx(0.02)
    assert per_client["TRM-1"].max_gap_delta_s == 0
    assert recommendation.target_reached is True
    assert recommendation.closest_run_id is None
    assert recommendation.availability_gap is None


def test_recommendation_shows_distance_to_unreached_target() -> None:
    recommendation = _recommendation_with_target(reached=False)
    assert recommendation.target_reached is False
    assert recommendation.closest_run_id == "shifted"
    assert recommendation.availability_gap == pytest.approx(0.04)


def test_base_stays_recommended_when_no_candidate_is_better() -> None:
    """Если менять нечего, рекомендацией остаётся базовый вариант с нулевыми дельтами."""
    base = _candidate("base", config=_config(min_client_availability=0.95))
    worse = _candidate("worse", config=_config(min_client_availability=0.90))
    recommendation = recommend(base, [worse])
    assert recommendation.recommended_run_id == "base"
    assert recommendation.changed_parameters == ()
    assert all(value == 0 for value in recommendation.deltas.values())
    assert recommendation.ranked_run_ids == ("base", "worse")


def test_base_is_not_duplicated_when_listed_among_candidates() -> None:
    base = _candidate("base")
    recommendation = recommend(base, [base, _candidate("other")])
    assert recommendation.ranked_run_ids == ("base", "other")


def test_limitations_are_built_from_run_conditions() -> None:
    recommendation = recommend(_candidate("base"), [])
    assert recommendation.limitations == (
        "Проверено на сетке 120 с и горизонте 24 ч",
        "Межспутниковая дальность 3000 км",
        "Минимальный угол возвышения 10°",
    )


def test_conditions_must_match_across_candidates() -> None:
    """Сравнение на разной сетке сопоставляло бы разные задачи, а не конфигурации."""
    other = RunConditions(
        step_s=60,
        horizon_s=86400,
        isl_range_km=3000.0,
        min_elevation_deg=10.0,
        target_availability=0.9,
    )
    with pytest.raises(ValueError, match="условия расчёта"):
        recommend(_candidate("base"), [_candidate("finer", conditions=other)])


def test_client_sets_must_match() -> None:
    base = _candidate("base", clients=(_client("TRM-0", 0.9, 120),))
    other = _candidate(
        "other",
        clients=(_client("TRM-9", 0.95, 120),),
        config=_config(min_client_availability=0.95),
    )
    with pytest.raises(ValueError, match="клиентских пунктов"):
        recommend(base, [other])


def test_conditions_come_from_scenario_environment() -> None:
    environment = Environment(
        altitude_km=550.0,
        inclination_deg=87.0,
        earth_angle0_deg=0.0,
        horizon_s=7200,
        step_s=120,
        min_elevation_deg=12.5,
        isl_range_km=2000.0,
        target_availability=0.95,
    )
    conditions = RunConditions.from_environment(environment)
    assert conditions == RunConditions(
        step_s=120,
        horizon_s=7200,
        isl_range_km=2000.0,
        min_elevation_deg=12.5,
        target_availability=0.95,
    )
    recommendation = recommend(_candidate("base", conditions=conditions), [])
    assert recommendation.limitations[0] == "Проверено на сетке 120 с и горизонте 2 ч"
