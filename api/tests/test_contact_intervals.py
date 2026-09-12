"""Интервалы контактов против самой битовой матрицы (`06_STORAGE.md` §4).

Интервалы — это то, что уходит в Memgraph вместо ребра на каждый отсчёт. Ошибка здесь
незаметна: граф выглядит правдоподобно, но описывает другую сеть. Поэтому интервалы
сверяются с матрицей, из которой получены, а не с записанным заранее ответом.
"""

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra.numpy import array_shapes, arrays
from numpy.typing import NDArray

from orbita_api.adapters.storage import contact_intervals, ones_runs
from plans import CASE_SCENARIO, HIDDEN_SCENARIO, load_plan


def rebuild_column(intervals: NDArray[np.int64], length: int) -> NDArray[np.bool_]:
    column = np.zeros(length, dtype=np.bool_)
    for start, end in intervals:
        column[start:end] = True
    return column


@given(
    column=arrays(
        dtype=np.bool_,
        shape=array_shapes(min_dims=1, max_dims=1, min_side=1, max_side=200),
        elements=st.booleans(),
    ),
)
def test_intervals_cover_exactly_the_ones(column: NDArray[np.bool_]) -> None:
    intervals = ones_runs(column)

    assert np.array_equal(rebuild_column(intervals, column.size), column)


@given(
    column=arrays(
        dtype=np.bool_,
        shape=array_shapes(min_dims=1, max_dims=1, min_side=1, max_side=200),
        elements=st.booleans(),
    ),
)
def test_intervals_are_maximal_and_disjoint(column: NDArray[np.bool_]) -> None:
    """Соседние интервалы обязаны быть разделены нулём.

    Иначе один контакт распался бы на два ребра графа, и число перерывов связи, которое
    по этим рёбрам считается, оказалось бы завышенным.
    """
    intervals = ones_runs(column)

    assert all(start < end for start, end in intervals)
    previous_end = -1
    for start, end in intervals:
        assert start > previous_end
        previous_end = int(end)


def test_empty_column_gives_no_intervals() -> None:
    assert ones_runs(np.zeros(10, dtype=np.bool_)).size == 0


def test_full_column_gives_single_interval() -> None:
    intervals = ones_runs(np.ones(10, dtype=np.bool_))

    assert intervals.tolist() == [[0, 10]]


@pytest.mark.parametrize("relative", [CASE_SCENARIO, HIDDEN_SCENARIO])
def test_plan_intervals_match_plan_bits(relative: str) -> None:
    """Интервалы всей трассы восстанавливают её битовую матрицу столбец в столбец."""
    plan = load_plan(relative)
    intervals = contact_intervals(plan)

    restored = np.zeros_like(plan.bits)
    index_of = {(plan.nodes[int(a)], plan.nodes[int(b)]): i for i, (a, b) in enumerate(plan.edges)}
    for interval in intervals:
        column = index_of[(interval.source, interval.target)]
        restored[interval.start_tick : interval.end_tick, column] = True

    assert np.array_equal(restored, plan.bits)


@pytest.mark.parametrize("relative", [HIDDEN_SCENARIO])
def test_interval_distance_bounds_come_from_the_same_window(relative: str) -> None:
    """Границы дальности берутся ровно с тех отсчётов, что попали в интервал."""
    plan = load_plan(relative)
    index_of = {(plan.nodes[int(a)], plan.nodes[int(b)]): i for i, (a, b) in enumerate(plan.edges)}

    for interval in contact_intervals(plan):
        column = index_of[(interval.source, interval.target)]
        window = plan.dist[interval.start_tick : interval.end_tick, column]
        assert interval.min_distance_km == pytest.approx(float(window.min()))
        assert interval.max_distance_km == pytest.approx(float(window.max()))
