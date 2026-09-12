"""Формат `trace.bin`: сериализация трассы запуска (ADR-010).

Трасса — это словарь узлов, список возможных рёбер и битовая матрица «отсчёты × рёбра».
Координаты не хранятся: их детерминированно восстановит ядро из сценария и времени, а
их запись увеличила бы объект на порядок.

Формат знает только api: ядро отдаёт `ContactPlan` и ничего не знает о том, где и как
он лежит.

Раскладка объекта:

```text
"ORBT" | версия (1 байт) | zstd( длина заголовка (uint32 LE) | заголовок JSON | массивы )
```

Массивы идут подряд в фиксированном порядке, их размеры вычисляются из заголовка:

| Массив | Тип | Форма |
|---|---|---|
| `edges` | int32 LE | `(E, 2)` |
| `kinds` | битовая маска `ground` | `(E,)` |
| `bits` | битовая матрица | `(ticks, E)` |
| `active` | битовая матрица | `(ticks, N)` |
| `gateway_available` | битовая матрица | `(ticks, G)` |
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import Any, Final

import numpy as np
import zstandard
from numpy.typing import NDArray
from orbita_core import geometry
from orbita_core.contacts import ContactPlan, EdgeKind
from orbita_core.scenario import Scenario

MAGIC: Final[bytes] = b"ORBT"
FORMAT_VERSION: Final[int] = 1

# Уровень выбран измерением на сценариях репозитория: 3 → 7,9 КБ за 0,15 мс, 10 → 6,7 КБ
# за 1,5 мс, 15 → 5,0 КБ за 6,6 мс, 19 → 4,8 КБ за 19,5 мс. После 15 время растёт втрое
# ради четырёх процентов объёма, поэтому взят он. Распаковка на всех уровнях — доли
# миллисекунды, а читают трассу чаще, чем пишут.
COMPRESSION_LEVEL: Final[int] = 15

_HEADER_LENGTH_FORMAT: Final[str] = "<I"
_HEADER_LENGTH_SIZE: Final[int] = struct.calcsize(_HEADER_LENGTH_FORMAT)
_PREFIX_SIZE: Final[int] = len(MAGIC) + 1

# Индексы узлов и отсчёты заведомо помещаются в int32: предел сценария - 5 000 аппаратов
# (`06_STORAGE.md` §7). Тип вдвое меньше int64 ядра и вдвое сокращает список рёбер.
_EDGE_DTYPE: Final[np.dtype[np.int32]] = np.dtype("<i4")


class TraceFormatError(ValueError):
    """Объект не является трассой или записан несовместимой версией формата."""


@dataclass(frozen=True, slots=True, eq=False)
class Trace:
    """Прочитанная трасса: всё, что нужно для снимка отсчёта, кроме координат."""

    nodes: tuple[str, ...]
    satellite_count: int
    step_s: int
    gateway_ids: tuple[str, ...]
    edges: NDArray[np.int64]
    kinds: tuple[EdgeKind, ...]
    bits: NDArray[np.bool_]
    active: NDArray[np.bool_]
    gateway_available: NDArray[np.bool_]

    @property
    def ticks(self) -> int:
        return int(self.bits.shape[0])

    @property
    def edge_count(self) -> int:
        return int(self.edges.shape[0])


def _pack(matrix: NDArray[np.bool_]) -> bytes:
    """Битовая матрица в байты: восемь отметок в байт вместо байта на отметку."""
    return bytes(np.packbits(matrix, axis=-1).tobytes())


def _packed_size(columns: int, rows: int = 1) -> int:
    return rows * ((columns + 7) // 8)


def _unpack(raw: bytes, rows: int, columns: int) -> NDArray[np.bool_]:
    packed = np.frombuffer(raw, dtype=np.uint8).reshape(rows, (columns + 7) // 8)
    unpacked = np.unpackbits(packed, axis=1, count=columns)
    return np.ascontiguousarray(unpacked.astype(np.bool_))


def encode_trace(plan: ContactPlan) -> bytes:
    """Упаковывает contact plan в объект `runs/{run_id}/trace.bin`."""
    header: dict[str, Any] = {
        "format_version": FORMAT_VERSION,
        "nodes": list(plan.nodes),
        "satellite_count": plan.satellite_count,
        "step_s": plan.step_s,
        "ticks": plan.ticks,
        "edge_count": plan.edge_count,
        "gateway_ids": list(plan.gateway_ids),
    }
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    ground = np.array([kind is EdgeKind.GROUND for kind in plan.kinds], dtype=np.bool_)
    body = b"".join(
        (
            struct.pack(_HEADER_LENGTH_FORMAT, len(header_bytes)),
            header_bytes,
            plan.edges.astype(_EDGE_DTYPE).tobytes(),
            _pack(ground),
            _pack(plan.bits),
            _pack(plan.active),
            _pack(plan.gateway_available),
        ),
    )
    compressed = zstandard.ZstdCompressor(level=COMPRESSION_LEVEL).compress(body)
    return MAGIC + bytes([FORMAT_VERSION]) + compressed


def decode_trace(blob: bytes) -> Trace:
    """Читает объект `trace.bin`, записанный `encode_trace`."""
    if len(blob) < _PREFIX_SIZE or blob[: len(MAGIC)] != MAGIC:
        raise TraceFormatError("объект не является трассой ОРБИТЫ")
    version = blob[len(MAGIC)]
    if version != FORMAT_VERSION:
        raise TraceFormatError(f"версия формата трассы {version} не поддерживается")

    body = zstandard.ZstdDecompressor().decompress(blob[_PREFIX_SIZE:])
    (header_length,) = struct.unpack_from(_HEADER_LENGTH_FORMAT, body)
    offset = _HEADER_LENGTH_SIZE
    header: dict[str, Any] = json.loads(body[offset : offset + header_length])
    offset += header_length

    nodes: tuple[str, ...] = tuple(header["nodes"])
    gateway_ids: tuple[str, ...] = tuple(header["gateway_ids"])
    ticks = int(header["ticks"])
    edge_count = int(header["edge_count"])
    satellite_count = int(header["satellite_count"])

    edges_size = edge_count * 2 * _EDGE_DTYPE.itemsize
    edges = np.frombuffer(body[offset : offset + edges_size], dtype=_EDGE_DTYPE)
    offset += edges_size

    kinds_size = _packed_size(edge_count)
    ground = _unpack(body[offset : offset + kinds_size], 1, edge_count)[0]
    offset += kinds_size

    bits_size = _packed_size(edge_count, ticks)
    bits = _unpack(body[offset : offset + bits_size], ticks, edge_count)
    offset += bits_size

    active_size = _packed_size(satellite_count, ticks)
    active = _unpack(body[offset : offset + active_size], ticks, satellite_count)
    offset += active_size

    gateway_size = _packed_size(len(gateway_ids), ticks)
    gateway_available = _unpack(body[offset : offset + gateway_size], ticks, len(gateway_ids))

    return Trace(
        nodes=nodes,
        satellite_count=satellite_count,
        step_s=int(header["step_s"]),
        gateway_ids=gateway_ids,
        edges=edges.astype(np.int64).reshape(edge_count, 2),
        kinds=tuple(EdgeKind.GROUND if is_ground else EdgeKind.ISL for is_ground in ground),
        bits=bits,
        active=active,
        gateway_available=gateway_available,
    )


def restore_plan(trace: Trace, scenario: Scenario) -> ContactPlan:
    """Собирает contact plan из трассы и сценария, которым она посчитана.

    Трасса хранит то, что зависит от расчёта: какие рёбра существовали, какие аппараты
    были активны, какие шлюзы доступны. Координаты и длины линий в ней не лежат — они
    однозначно восстанавливаются из сценария и времени (ADR-010), а их запись увеличила
    бы объект на порядок.

    Несовпадение состава узлов означает, что трассу посчитали по другому сценарию: молча
    подставить чужую геометрию нельзя, метрики стали бы ложью.
    """
    nodes = tuple(satellite.id for satellite in scenario.satellites) + tuple(
        site.id for site in scenario.ground_sites
    )
    if nodes != trace.nodes:
        raise TraceFormatError("состав узлов трассы не совпадает со сценарием запуска")

    positions = geometry.positions_all(scenario)
    site_positions = geometry.ground_positions(scenario)
    # Пункты неподвижны в земной системе, аппараты движутся: общий массив координат узлов
    # позволяет взять длину любого ребра одним выражением, не разделяя ISL и наземные.
    node_positions = np.concatenate(
        (positions, np.broadcast_to(site_positions, (trace.ticks, *site_positions.shape))),
        axis=1,
    )
    delta = node_positions[:, trace.edges[:, 0], :] - node_positions[:, trace.edges[:, 1], :]
    distance_km: NDArray[np.float64] = np.linalg.norm(delta, axis=2)

    return ContactPlan(
        nodes=trace.nodes,
        node_index={node: index for index, node in enumerate(trace.nodes)},
        satellite_count=trace.satellite_count,
        step_s=trace.step_s,
        edges=trace.edges,
        kinds=trace.kinds,
        bits=trace.bits,
        dist=np.ascontiguousarray(distance_km),
        active=trace.active,
        gateway_ids=trace.gateway_ids,
        gateway_available=trace.gateway_available,
        positions=positions,
    )
