"""Checks for the large-constellation ISL candidate pruning."""

from __future__ import annotations

import numpy as np

from orbita_core import geometry


def test_pruning_is_a_safe_subset_of_full_isl_enumeration() -> None:
    satellite_count = 130
    # Two compact groups on opposite sides of the orbit.  Cross-group boxes
    # are much farther apart than the ISL range and can be discarded safely.
    positions = np.zeros((3, satellite_count, 3), dtype=np.float64)
    positions[:, :65, 0] = 7000.0
    positions[:, 65:, 0] = -7000.0
    positions[1, :65, 1] = np.linspace(-20.0, 20.0, 65)
    positions[2, 65:, 1] = np.linspace(-20.0, 20.0, 65)

    full_indices = geometry.isl_pair_indices(satellite_count)
    pruned_indices = geometry.isl_pair_indices(
        satellite_count,
        positions=positions,
        isl_range_km=1000.0,
        pruning_threshold=0,
    )

    full_pairs_ordered = list(zip(full_indices[0].tolist(), full_indices[1].tolist(), strict=True))
    full_pairs = set(full_pairs_ordered)
    pruned_pairs = set(zip(pruned_indices[0].tolist(), pruned_indices[1].tolist(), strict=True))
    assert pruned_pairs < full_pairs

    full_visible, _ = geometry.isl_visible_all(positions, 1000.0, pair_indices=full_indices)
    pruned_visible, _ = geometry.isl_visible_all(positions, 1000.0, pair_indices=pruned_indices)
    # Preserve the array's pair ordering; sets are intentionally unordered.
    visible_by_pair = dict(zip(full_pairs_ordered, full_visible[0].tolist(), strict=True))
    assert all(not visible_by_pair[pair] for pair in full_pairs - pruned_pairs)
    assert all(
        visible_by_pair[pair] == bool(pruned_visible[0, index])
        for index, pair in enumerate(zip(pruned_indices[0], pruned_indices[1], strict=True))
    )


def test_pruning_falls_back_to_full_for_small_constellations() -> None:
    positions = np.zeros((1, 48, 3), dtype=np.float64)
    baseline = geometry.isl_pair_indices(48)
    actual = geometry.isl_pair_indices(48, positions=positions, isl_range_km=1.0)
    assert np.array_equal(actual[0], baseline[0])
    assert np.array_equal(actual[1], baseline[1])


def test_pruning_falls_back_when_the_range_is_not_finite() -> None:
    positions = np.zeros((1, 130, 3), dtype=np.float64)
    baseline = geometry.isl_pair_indices(130)
    actual = geometry.isl_pair_indices(
        130,
        positions=positions,
        isl_range_km=float("nan"),
    )

    assert np.array_equal(actual[0], baseline[0])
    assert np.array_equal(actual[1], baseline[1])
