"""Сетка исследования пространства проекта: границы, порядок, бюджет, подстановка.

Сценарий берётся синтетический, с идентификаторами, которых нет в кейсе (ADR-015):
сетка не должна зависеть ни от одного конкретного файла.
"""

from __future__ import annotations

import math
from typing import Any, Final

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from orbita_core.scenario import parse
from orbita_core.sweep import (
    LAUNCH_STAGE_PATH,
    Axis,
    AxisPathError,
    BudgetExceeded,
    Point,
    apply_point,
    grid,
)
from tests.support import synthetic_scenario

FIRST_PLANE_RAAN: Final[str] = "design.planes[0].raan_deg"
SECOND_PLANE_PHASE: Final[str] = "design.planes[1].phase_deg"

# Бюджет, заведомо больший любой сетки этого файла: тесты порядка и значений не должны
# спотыкаться о бюджет.
WIDE_BUDGET: Final[int] = 10_000


def test_one_dimensional_grid_includes_both_ends() -> None:
    points = grid([Axis(FIRST_PLANE_RAAN, 0.0, 90.0, 30.0)], WIDE_BUDGET)

    assert [point.params[FIRST_PLANE_RAAN] for point in points] == [0.0, 30.0, 60.0, 90.0]


def test_grid_keeps_the_last_value_despite_rounding() -> None:
    """Шаг 0,1 не складывается в 0,3 точно; правый конец диапазона обязан войти в сетку."""
    points = grid([Axis(FIRST_PLANE_RAAN, 0.0, 0.3, 0.1)], WIDE_BUDGET)

    assert len(points) == 4
    assert points[-1].params[FIRST_PLANE_RAAN] == pytest.approx(0.3)


def test_grid_drops_the_value_that_does_not_fit_the_step() -> None:
    """Диапазон не кратен шагу: последняя точка — последняя целая, а не конец диапазона."""
    points = grid([Axis(FIRST_PLANE_RAAN, 0.0, 100.0, 30.0)], WIDE_BUDGET)

    assert [point.params[FIRST_PLANE_RAAN] for point in points] == [0.0, 30.0, 60.0, 90.0]


def test_single_value_axis_gives_single_point() -> None:
    points = grid([Axis(FIRST_PLANE_RAAN, 45.0, 45.0, 15.0)], WIDE_BUDGET)

    assert [point.params for point in points] == [{FIRST_PLANE_RAAN: 45.0}]


def test_angles_are_normalized_into_the_half_open_turn() -> None:
    points = grid([Axis(FIRST_PLANE_RAAN, 340.0, 380.0, 20.0)], WIDE_BUDGET)

    assert [point.params[FIRST_PLANE_RAAN] for point in points] == [340.0, 0.0, 20.0]


def test_full_turn_does_not_repeat_the_starting_angle() -> None:
    """0° и 360° — один и тот же угол и один и тот же `config_hash` (ADR-011)."""
    points = grid([Axis(FIRST_PLANE_RAAN, 0.0, 360.0, 90.0)], WIDE_BUDGET)

    assert [point.params[FIRST_PLANE_RAAN] for point in points] == [0.0, 90.0, 180.0, 270.0]


def test_two_dimensional_grid_changes_the_last_axis_first() -> None:
    points = grid(
        [Axis(FIRST_PLANE_RAAN, 0.0, 10.0, 10.0), Axis(SECOND_PLANE_PHASE, 0.0, 20.0, 10.0)],
        WIDE_BUDGET,
    )

    pairs = [(point.params[FIRST_PLANE_RAAN], point.params[SECOND_PLANE_PHASE]) for point in points]

    assert pairs == [
        (0.0, 0.0),
        (0.0, 10.0),
        (0.0, 20.0),
        (10.0, 0.0),
        (10.0, 10.0),
        (10.0, 20.0),
    ]


def test_grid_is_deterministic() -> None:
    axes = [Axis(FIRST_PLANE_RAAN, 0.0, 40.0, 10.0), Axis(SECOND_PLANE_PHASE, 0.0, 30.0, 15.0)]

    assert grid(axes, WIDE_BUDGET) == grid(axes, WIDE_BUDGET)


def test_launch_stage_axis_gives_whole_stages() -> None:
    points = grid([Axis(LAUNCH_STAGE_PATH, 1.0, 3.0, 1.0)], WIDE_BUDGET)

    assert [point.params[LAUNCH_STAGE_PATH] for point in points] == [1.0, 2.0, 3.0]


def test_launch_stage_axis_rejects_fractional_stages() -> None:
    with pytest.raises(AxisPathError, match="целыми"):
        Axis(LAUNCH_STAGE_PATH, 1.0, 3.0, 0.5)


def test_budget_of_exactly_the_grid_size_is_allowed() -> None:
    points = grid([Axis(FIRST_PLANE_RAAN, 0.0, 30.0, 10.0)], max_points=4)

    assert len(points) == 4


def test_budget_smaller_than_the_grid_is_rejected() -> None:
    with pytest.raises(BudgetExceeded) as error:
        grid(
            [Axis(FIRST_PLANE_RAAN, 0.0, 40.0, 10.0), Axis(SECOND_PLANE_PHASE, 0.0, 40.0, 10.0)],
            max_points=10,
        )

    assert error.value.points_needed == 25
    assert error.value.max_points == 10


def test_budget_is_checked_before_the_points_are_built() -> None:
    """Мелкий шаг на двух осях даёт миллионы комбинаций; собирать их в память нельзя."""
    axes = [
        Axis(FIRST_PLANE_RAAN, 0.0, 359.0, 0.001),
        Axis(SECOND_PLANE_PHASE, 0.0, 359.0, 0.001),
    ]

    with pytest.raises(BudgetExceeded) as error:
        grid(axes, max_points=100)

    assert error.value.points_needed > 100


@pytest.mark.parametrize(
    ("start", "stop", "step"),
    [(0.0, 90.0, 0.0), (0.0, 90.0, -10.0), (90.0, 0.0, 10.0), (math.inf, 90.0, 10.0)],
)
def test_axis_rejects_a_range_that_gives_no_grid(start: float, stop: float, step: float) -> None:
    with pytest.raises(AxisPathError):
        Axis(FIRST_PLANE_RAAN, start, stop, step)


@pytest.mark.parametrize(
    "path",
    [
        "environment.step_s",
        "design.planes[0].slot_deg",
        "design.satellites[0].launch_batch",
        "design.planes[0]",
        "",
    ],
)
def test_axis_rejects_a_parameter_that_must_not_be_swept(path: str) -> None:
    """Сетка по шагу или горизонту сравнивала бы расчёты разных задач (`01_SPEC.md` §7)."""
    with pytest.raises(AxisPathError) as error:
        Axis(path, 0.0, 10.0, 1.0)

    assert error.value.path == path


def test_grid_rejects_repeated_axes() -> None:
    with pytest.raises(ValueError, match="повторяют"):
        grid([Axis(FIRST_PLANE_RAAN, 0.0, 10.0, 5.0), Axis(FIRST_PLANE_RAAN, 0.0, 10.0, 5.0)], 100)


def test_grid_rejects_an_empty_axis_list() -> None:
    with pytest.raises(ValueError, match="хотя бы одна ось"):
        grid([], 100)


def test_apply_point_sets_the_named_plane() -> None:
    scenario = synthetic_scenario()
    plane_id = str(scenario["design"]["planes"][1]["id"])
    point = Point(((f"design.planes[{plane_id}].raan_deg", 123.5),))

    applied = apply_point(scenario, point)

    planes: list[dict[str, Any]] = applied["design"]["planes"]  # type: ignore[index]
    assert planes[1]["raan_deg"] == pytest.approx(123.5)
    assert planes[0]["raan_deg"] == pytest.approx(scenario["design"]["planes"][0]["raan_deg"])


def test_apply_point_leaves_the_input_untouched() -> None:
    scenario = synthetic_scenario()
    before = scenario["design"]["planes"][0]["raan_deg"]

    apply_point(scenario, Point(((FIRST_PLANE_RAAN, 200.0),)))

    assert scenario["design"]["planes"][0]["raan_deg"] == before


def test_apply_point_changes_the_launch_stage() -> None:
    scenario = synthetic_scenario(launch_stage=3)

    applied = apply_point(scenario, Point(((LAUNCH_STAGE_PATH, 1.0),)))

    assert applied["design"]["launch_stage"] == 1  # type: ignore[index]


def test_apply_point_reports_a_plane_that_is_not_in_the_scenario() -> None:
    scenario = synthetic_scenario()
    path = "design.planes[ORB-Z].phase_deg"

    with pytest.raises(AxisPathError) as error:
        apply_point(scenario, Point(((path, 10.0),)))

    assert error.value.path == path


def test_equal_points_give_equal_canonical_scenarios() -> None:
    """Один и тот же угол, записанный по-разному, обязан дать один сценарий (ADR-011)."""
    scenario = synthetic_scenario()

    direct = apply_point(scenario, Point(((FIRST_PLANE_RAAN, 30.0),)))
    normalized = apply_point(scenario, grid([Axis(FIRST_PLANE_RAAN, 390.0, 390.0, 30.0)], 5)[0])

    assert direct == normalized


@settings(max_examples=25, deadline=None)
@given(
    start=st.floats(min_value=0.0, max_value=359.0),
    span=st.floats(min_value=0.0, max_value=180.0),
    step=st.floats(min_value=0.5, max_value=90.0),
    field=st.sampled_from(["raan_deg", "phase_deg"]),
    plane=st.sampled_from([0, 1]),
)
def test_every_grid_point_gives_a_scenario_the_core_accepts(
    start: float,
    span: float,
    step: float,
    field: str,
    plane: int,
) -> None:
    """Подстановка любого значения оси обязана давать сценарий без ошибок валидации."""
    scenario = synthetic_scenario()
    axis = Axis(f"design.planes[{plane}].{field}", start, start + span, step)

    for point in grid([axis], WIDE_BUDGET):
        applied = apply_point(scenario, point)
        parsed = parse(applied)
        value = point.params[axis.path]
        assert 0.0 <= value < 360.0
        assert getattr(parsed.planes[plane], field) == pytest.approx(value)
