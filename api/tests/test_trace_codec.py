"""Формат `trace.bin`: запись и чтение трассы (ADR-010).

Трасса — единственный артефакт, который нельзя получить заново без пересчёта, поэтому
проверяется не «объект получился», а совпадение всех матриц после обратного разбора.
"""

from typing import Final

import numpy as np
import pytest

from orbita_api.services.trace_codec import (
    FORMAT_VERSION,
    MAGIC,
    TraceFormatError,
    decode_trace,
    encode_trace,
)
from plans import CASE_SCENARIO, HIDDEN_SCENARIO, load_plan

BITS_IN_BYTE: Final[int] = 8

SCENARIOS: Final[tuple[str, ...]] = (CASE_SCENARIO, HIDDEN_SCENARIO)


@pytest.mark.parametrize("relative", SCENARIOS)
def test_roundtrip_restores_every_matrix(relative: str) -> None:
    plan = load_plan(relative)

    trace = decode_trace(encode_trace(plan))

    assert trace.nodes == plan.nodes
    assert trace.satellite_count == plan.satellite_count
    assert trace.step_s == plan.step_s
    assert trace.gateway_ids == plan.gateway_ids
    assert trace.kinds == plan.kinds
    assert np.array_equal(trace.edges, plan.edges)
    assert np.array_equal(trace.bits, plan.bits)
    assert np.array_equal(trace.active, plan.active)
    assert np.array_equal(trace.gateway_available, plan.gateway_available)


@pytest.mark.parametrize("relative", SCENARIOS)
def test_object_is_smaller_than_raw_bitset(relative: str) -> None:
    """Сжатие обязано окупать формат: иначе проще хранить голую матрицу."""
    plan = load_plan(relative)

    blob = encode_trace(plan)

    raw_bytes = plan.ticks * plan.edge_count // BITS_IN_BYTE
    assert len(blob) < raw_bytes


def test_decoded_trace_reports_same_shape_as_plan() -> None:
    plan = load_plan(HIDDEN_SCENARIO)

    trace = decode_trace(encode_trace(plan))

    assert trace.ticks == plan.ticks
    assert trace.edge_count == plan.edge_count


def test_foreign_object_is_rejected() -> None:
    """Чужой объект по ключу трассы должен обнаруживаться разбором, а не падением."""
    with pytest.raises(TraceFormatError):
        decode_trace(b"not a trace at all")


def test_unknown_format_version_is_rejected() -> None:
    """Трасса, записанная будущей версией, читается не молча и не наполовину."""
    plan = load_plan(HIDDEN_SCENARIO)
    blob = encode_trace(plan)
    forged = MAGIC + bytes([FORMAT_VERSION + 1]) + blob[len(MAGIC) + 1 :]

    with pytest.raises(TraceFormatError):
        decode_trace(forged)
