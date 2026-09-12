"""Deterministic one/two dimensional configuration sweeps."""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from orbita_core.scenario import normalize_angle_deg, parse, to_dict

LAUNCH_STAGE_PATH = "design.launch_stage"
_PLANE = re.compile(r"^design\.planes\[(?P<key>[^\[\]]+)\]\.(?P<field>raan_deg|phase_deg)$")


class AxisPathError(ValueError):
    def __init__(self, path: str, message: str) -> None:
        self.path = path
        super().__init__(message)


class BudgetExceeded(Exception):  # noqa: N818
    def __init__(self, points_needed: int, max_points: int) -> None:
        self.points_needed, self.max_points = points_needed, max_points
        super().__init__(f"grid needs {points_needed} points (budget {max_points})")


@dataclass(frozen=True, slots=True)
class Axis:
    path: str
    start: float
    stop: float
    step: float

    def __post_init__(self) -> None:
        _kind(self.path)
        if not all(math.isfinite(v) for v in (self.start, self.stop)) or self.stop < self.start:
            raise AxisPathError(self.path, "invalid axis bounds")
        if not math.isfinite(self.step) or self.step <= 0:
            raise AxisPathError(self.path, "axis step must be positive")

    def values(self) -> tuple[float, ...]:
        kind = _kind(self.path)
        n = math.floor((self.stop - self.start) / self.step + 1e-9) + 1
        out: list[float] = []
        seen: set[float] = set()
        for i in range(n):
            value = kind(self.start + i * self.step)
            key = round(value, 9)
            if key not in seen:
                seen.add(key)
                out.append(value)
        return tuple(out)


@dataclass(frozen=True, slots=True)
class Point:
    values: tuple[tuple[str, float], ...]

    @property
    def params(self) -> dict[str, float]:
        return dict(self.values)


def _kind(path: str) -> Callable[[float], float]:
    if path == LAUNCH_STAGE_PATH:
        return lambda x: float(round(x))
    if _PLANE.match(path):
        return normalize_angle_deg
    raise AxisPathError(path, "unsupported sweep axis")


def grid(axes: Sequence[Axis], max_points: int) -> list[Point]:
    if not axes or max_points < 1:
        raise ValueError("at least one axis and positive budget required")
    if len({a.path for a in axes}) != len(axes):
        raise ValueError("duplicate sweep axis")
    cols = [a.values() for a in axes]
    needed = math.prod(map(len, cols))
    if needed > max_points:
        raise BudgetExceeded(needed, max_points)
    points = [Point(())]
    for axis, values in zip(axes, cols, strict=True):
        points = [Point((*p.values, (axis.path, value))) for p in points for value in values]
    return points


def _plane(draft: dict[str, Any], key: str, path: str) -> dict[str, Any]:
    planes = draft.get("design", {}).get("planes")
    if not isinstance(planes, list):
        raise AxisPathError(path, "scenario has no planes")
    if key.isdigit():
        i = int(key)
        if i >= len(planes):
            raise AxisPathError(path, "plane index out of range")
        return planes[i]
    for p in planes:
        if isinstance(p, dict) and str(p.get("id")) == key:
            return p
    raise AxisPathError(path, "plane not found")


def apply_point(scenario: Mapping[str, object], point: Point) -> dict[str, object]:
    draft = copy.deepcopy(dict(scenario))
    for path, value in point.values:
        if path == LAUNCH_STAGE_PATH:
            design = draft.get("design")
            if not isinstance(design, dict):
                raise AxisPathError(path, "scenario has no design section")
            design["launch_stage"] = round(value)
            continue
        match = _PLANE.match(path)
        if not match:
            raise AxisPathError(path, "unsupported sweep axis")
        _plane(draft, match.group("key"), path)[match.group("field")] = float(value)
    return to_dict(parse(draft))


__all__ = [
    "LAUNCH_STAGE_PATH",
    "Axis",
    "AxisPathError",
    "BudgetExceeded",
    "Point",
    "apply_point",
    "grid",
]
