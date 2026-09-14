"""Сравнение перерывов и маршрутов двух расчётов одной задачи.

Пары строятся синтетически: интересны не орбиты, а сами конфигурации перерывов —
появился, исчез, сдвинулся, слился из двух, коснулся края сетки. Поверх примеров идёт
property-тест на случайных масках доступности: набор изменений обязан сходиться с
симметрической разностью масок, иначе сравнение теряет или выдумывает перерывы.
"""

from __future__ import annotations

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from orbita_core.compare import (
    OutageChangeKind,
    compare_client,
    compare_routes,
    outage_diff,
)
from orbita_core.diagnosis import OutageCause
from orbita_core.metrics import OutageInterval, outage_runs

STEP_S = 120
CLIENT = "TRM-0"
OTHER_CLIENT = "TRM-1"

# Маршруты синтетических примеров: конкретные узлы неважны, важно их совпадение.
FIRST_PATH: tuple[str, ...] = (CLIENT, "SAT-01", "GW-0")
SECOND_PATH: tuple[str, ...] = (CLIENT, "SAT-02", "GW-0")


def outage(
    start_s: int,
    end_s: int,
    *,
    client_id: str = CLIENT,
    primary_cause: OutageCause = OutageCause.NO_CLIENT_COVERAGE,
    failed_satellites: tuple[str, ...] = (),
) -> OutageInterval:
    """Перерыв с заполненными обязательными полями: сравнению нужны границы и причина."""
    return OutageInterval(
        client_id=client_id,
        start_s=start_s,
        end_s=end_s,
        duration_s=end_s - start_s,
        truncated_by_horizon=False,
        primary_cause=primary_cause,
        causes=(primary_cause,),
        client_visible_satellites=(),
        gateway_visible_satellites=(),
        failed_satellites=failed_satellites,
        client_component_id=None,
        gateway_component_id=None,
        last_path=None,
        next_path=None,
    )


def outages_of(reachable: list[bool], client_id: str = CLIENT) -> list[OutageInterval]:
    """Перерывы клиента по маске доступности: те же границы, что считает ядро."""
    mask = np.array(reachable, dtype=np.bool_)
    return [
        outage(start * STEP_S, stop * STEP_S, client_id=client_id)
        for start, stop in outage_runs(mask)
    ]


def paths_of(reachable: list[bool]) -> list[tuple[str, ...] | None]:
    """Маршруты по маске доступности: один и тот же путь на всех доступных отсчётах."""
    return [FIRST_PATH if value else None for value in reachable]


def spans(intervals: list[OutageInterval]) -> set[tuple[int, int]]:
    return {(interval.start_s, interval.end_s) for interval in intervals}


def test_new_outage_is_reported_as_added() -> None:
    changes = outage_diff([], [outage(240, 480)], STEP_S)

    assert [change.kind for change in changes] == [OutageChangeKind.ADDED]
    assert (changes[0].other_start_s, changes[0].other_end_s) == (240, 480)
    assert (changes[0].base_start_s, changes[0].base_end_s) == (None, None)


def test_disappeared_outage_is_reported_as_removed() -> None:
    changes = outage_diff([outage(240, 480)], [], STEP_S)

    assert [change.kind for change in changes] == [OutageChangeKind.REMOVED]
    assert (changes[0].base_start_s, changes[0].base_end_s) == (240, 480)
    assert (changes[0].other_start_s, changes[0].other_end_s) == (None, None)


def test_identical_outages_are_not_reported() -> None:
    intervals = [outage(240, 480), outage(960, 1200)]

    assert outage_diff(intervals, list(intervals), STEP_S) == []


def test_shifted_outage_keeps_both_borders() -> None:
    changes = outage_diff([outage(240, 480)], [outage(360, 720)], STEP_S)

    assert [change.kind for change in changes] == [OutageChangeKind.CHANGED]
    assert (changes[0].base_start_s, changes[0].base_end_s) == (240, 480)
    assert (changes[0].other_start_s, changes[0].other_end_s) == (360, 720)


def test_two_outages_merged_into_one_are_reported_by_both_halves() -> None:
    base = [outage(240, 480), outage(720, 960)]

    changes = outage_diff(base, [outage(240, 960)], STEP_S)

    assert [change.kind for change in changes] == [
        OutageChangeKind.CHANGED,
        OutageChangeKind.CHANGED,
    ]
    assert [(change.base_start_s, change.base_end_s) for change in changes] == [
        (240, 480),
        (720, 960),
    ]
    assert {(change.other_start_s, change.other_end_s) for change in changes} == {(240, 960)}


def test_one_outage_split_in_two_is_reported_by_both_halves() -> None:
    other = [outage(240, 480), outage(720, 960)]

    changes = outage_diff([outage(240, 960)], other, STEP_S)

    assert [(change.other_start_s, change.other_end_s) for change in changes] == [
        (240, 480),
        (720, 960),
    ]
    assert {change.kind for change in changes} == {OutageChangeKind.CHANGED}


def test_outage_at_the_edge_of_the_grid_is_compared_like_any_other() -> None:
    changes = outage_diff([outage(0, 240)], [outage(0, 600)], STEP_S)

    assert [change.kind for change in changes] == [OutageChangeKind.CHANGED]
    assert (changes[0].base_start_s, changes[0].other_end_s) == (0, 600)


def test_changes_are_ordered_by_time() -> None:
    base = [outage(240, 480), outage(1200, 1440)]
    other = [outage(720, 840), outage(1200, 1560)]

    changes = outage_diff(base, other, STEP_S)

    assert [change.kind for change in changes] == [
        OutageChangeKind.REMOVED,
        OutageChangeKind.ADDED,
        OutageChangeKind.CHANGED,
    ]


def test_added_outage_carries_the_cause_and_failures_of_the_run_after() -> None:
    after = outage(
        240,
        480,
        primary_cause=OutageCause.NETWORK_PARTITION,
        failed_satellites=("SAT-03", "SAT-07"),
    )

    changes = outage_diff([], [after], STEP_S)

    assert changes[0].primary_cause is OutageCause.NETWORK_PARTITION
    assert changes[0].causes == (OutageCause.NETWORK_PARTITION,)
    assert changes[0].failed_satellites == ("SAT-03", "SAT-07")


def test_changed_outage_explains_itself_by_the_run_after() -> None:
    before = outage(240, 480, primary_cause=OutageCause.NO_CLIENT_COVERAGE)
    after = outage(
        240,
        720,
        primary_cause=OutageCause.NETWORK_PARTITION,
        failed_satellites=("SAT-05",),
    )

    changes = outage_diff([before], [after], STEP_S)

    assert changes[0].primary_cause is OutageCause.NETWORK_PARTITION
    assert changes[0].failed_satellites == ("SAT-05",)


def test_interval_off_the_grid_is_rejected() -> None:
    with pytest.raises(ValueError, match="сетке"):
        outage_diff([], [outage(250, 480)], STEP_S)


def test_outages_of_different_clients_are_rejected() -> None:
    with pytest.raises(ValueError, match="разных клиентов"):
        outage_diff([outage(240, 480)], [outage(240, 480, client_id=OTHER_CLIENT)], STEP_S)


def test_kept_and_rebuilt_ticks_are_counted_separately() -> None:
    base = [FIRST_PATH, FIRST_PATH, FIRST_PATH, None]
    other = [FIRST_PATH, SECOND_PATH, None, None]

    comparison = compare_routes(base, other, STEP_S)

    assert comparison.route_kept_ticks == 1
    assert comparison.route_rebuilt_ticks == 1


def test_first_divergence_sees_a_rebuilt_route_before_any_outage() -> None:
    base = [FIRST_PATH, FIRST_PATH, FIRST_PATH]
    other = [FIRST_PATH, SECOND_PATH, None]

    comparison = compare_routes(base, other, STEP_S)

    assert comparison.first_divergence_t_s == STEP_S
    assert comparison.first_new_outage_t_s == 2 * STEP_S


def test_equal_routes_diverge_nowhere() -> None:
    routes = [FIRST_PATH, None, FIRST_PATH]

    comparison = compare_routes(routes, list(routes), STEP_S)

    assert comparison.first_divergence_t_s is None
    assert comparison.first_new_outage_t_s is None
    assert comparison.route_kept_ticks == 2


def test_a_disappeared_outage_is_not_a_new_outage() -> None:
    base = [None, FIRST_PATH]
    other = [FIRST_PATH, FIRST_PATH]

    comparison = compare_routes(base, other, STEP_S)

    assert comparison.first_divergence_t_s == 0
    assert comparison.first_new_outage_t_s is None


def test_routes_of_different_horizons_are_rejected() -> None:
    with pytest.raises(ValueError, match="числе отсчётов"):
        compare_routes([FIRST_PATH], [FIRST_PATH, FIRST_PATH], STEP_S)


def test_client_with_a_new_outage_is_affected() -> None:
    base = [True, True, True, True]
    other = [True, False, False, True]

    comparison = compare_client(
        CLIENT,
        base_paths=paths_of(base),
        other_paths=paths_of(other),
        base_outages=outages_of(base),
        other_outages=outages_of(other),
        step_s=STEP_S,
    )

    assert comparison.affected
    assert [change.kind for change in comparison.outage_diff] == [OutageChangeKind.ADDED]
    assert comparison.first_new_outage_t_s == STEP_S
    assert comparison.route_kept_ticks == 2


def test_client_whose_route_only_changed_is_not_affected() -> None:
    reachable = [True, True]

    comparison = compare_client(
        CLIENT,
        base_paths=[FIRST_PATH, FIRST_PATH],
        other_paths=[FIRST_PATH, SECOND_PATH],
        base_outages=outages_of(reachable),
        other_outages=outages_of(reachable),
        step_s=STEP_S,
    )

    assert not comparison.affected
    assert comparison.route_rebuilt_ticks == 1
    assert comparison.first_divergence_t_s == STEP_S


def test_client_whose_outage_only_disappeared_is_not_affected() -> None:
    base = [True, False, True]
    other = [True, True, True]

    comparison = compare_client(
        CLIENT,
        base_paths=paths_of(base),
        other_paths=paths_of(other),
        base_outages=outages_of(base),
        other_outages=outages_of(other),
        step_s=STEP_S,
    )

    assert not comparison.affected
    assert [change.kind for change in comparison.outage_diff] == [OutageChangeKind.REMOVED]


@st.composite
def _mask_pairs(draw: st.DrawFn) -> tuple[list[bool], list[bool]]:
    """Пара масок доступности одного клиента на одной сетке отсчётов."""
    ticks = draw(st.integers(min_value=1, max_value=40))
    masks = st.lists(st.booleans(), min_size=ticks, max_size=ticks)
    return draw(masks), draw(masks)


@given(masks=_mask_pairs())
def test_changes_agree_with_the_symmetric_difference_of_masks(
    masks: tuple[list[bool], list[bool]],
) -> None:
    """Изменения описывают ровно те перерывы, которые не совпали у двух расчётов.

    Перерыв, одинаковый в обоих расчётах, в изменения не попадает; любой другой попадает
    ровно один раз со своей стороны. Отсюда же следует, что при совпавших масках список
    изменений пуст.
    """
    base_mask, other_mask = masks
    base = outages_of(base_mask)
    other = outages_of(other_mask)

    changes = outage_diff(base, other, STEP_S)
    unchanged = spans(base) & spans(other)

    reported_base = {
        (change.base_start_s, change.base_end_s)
        for change in changes
        if change.kind is not OutageChangeKind.ADDED
    }
    reported_other = {
        (change.other_start_s, change.other_end_s)
        for change in changes
        if change.kind is not OutageChangeKind.REMOVED
    }
    assert reported_base == spans(base) - unchanged
    assert reported_other == spans(other) - unchanged


@given(masks=_mask_pairs())
def test_every_differing_tick_falls_inside_a_reported_change(
    masks: tuple[list[bool], list[bool]],
) -> None:
    """Ни один отсчёт, на котором расчёты разошлись, не остаётся без объяснения."""
    base_mask, other_mask = masks
    changes = outage_diff(outages_of(base_mask), outages_of(other_mask), STEP_S)

    covered: set[int] = set()
    for change in changes:
        for start, end in (
            (change.base_start_s, change.base_end_s),
            (change.other_start_s, change.other_end_s),
        ):
            if start is not None and end is not None:
                covered.update(range(start // STEP_S, end // STEP_S))

    differing = {
        tick
        for tick, (before, after) in enumerate(zip(base_mask, other_mask, strict=True))
        if before != after
    }
    assert differing <= covered
