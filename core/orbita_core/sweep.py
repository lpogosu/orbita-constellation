"""Сетка конфигураций для исследования пространства проекта (`04_CORE.md` §7).

Перебирается одна или две оси: наклонение плоскости по долготе восходящего узла, её фаза
или этап запуска. `04_CORE.md` §7 допускает «равномерную сетку или Sobol»; здесь
реализована равномерная сетка, потому что на двух осях она даёт heatmap без пропусков,
а квазислучайная последовательность оставила бы в ячейках дыры и первый же экран
исследования пришлось бы интерполировать.

Модуль не знает ни про Run, ни про Variant: он получает словарь сценария и возвращает
словарь сценария. Связывать точки с запусками — дело слоя приложения (ADR-001).
"""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, TypeAlias

from orbita_core.scenario import normalize_angle_deg, parse, to_dict

# Ось «этап запуска»: у сценария он один на весь проект, поэтому путь без индекса.
LAUNCH_STAGE_PATH: Final[str] = "design.launch_stage"

# Ось угла плоскости. В скобках либо порядковый номер плоскости, либо её идентификатор:
# интерфейс знает плоскости по имени, а сохранённая ось должна читаться и тогда, когда
# порядок плоскостей в файле изменился.
_PLANE_AXIS: Final[re.Pattern[str]] = re.compile(
    r"^design\.planes\[(?P<key>[^\[\]]+)\]\.(?P<field>raan_deg|phase_deg)$",
)

# Сетка строится сложением шага, и накопленная ошибка double мешает попасть в правый
# конец диапазона: 0 + 0,1 · 3 даёт 0,30000000000000004. Допуск берётся долей шага,
# потому что абсолютная погрешность зависит от масштаба значений.
_STEP_TOLERANCE: Final[float] = 1e-9

# Разрядов, по которым значения оси считаются совпавшими. Округление вместо сравнения с
# допуском: сетка с мелким шагом содержит сотни тысяч значений, и попарное сравнение
# заняло бы квадратичное время ещё до проверки бюджета.
_VALUE_DIGITS: Final[int] = 9


class AxisPathError(ValueError):
    """Путь оси не указывает ни на один параметр, который можно перебирать.

    Хранит сам путь: слой API обязан ответить, какое поле запроса неверно, а не общей
    фразой про ось (`05_API.md` §3).
    """

    def __init__(self, path: str, message: str) -> None:
        self.path = path
        super().__init__(message)


# Имя без суффикса `Error` намеренно: оно совпадает с кодом ошибки контракта
# `EXPERIMENT_BUDGET_EXCEEDED`, и читающий трассу видит ту же строку, что и клиент API.
class BudgetExceeded(Exception):  # noqa: N818
    """Сетка не помещается в бюджет точек (`06_STORAGE.md` §7).

    Проверка идёт до построения списка точек: перебор двух осей с мелким шагом даёт
    миллионы комбинаций, и собирать их в память ради того, чтобы отвергнуть, незачем.
    """

    def __init__(self, points_needed: int, max_points: int) -> None:
        self.points_needed = points_needed
        self.max_points = max_points
        super().__init__(f"сетке нужно {points_needed} точек при бюджете {max_points}")


@dataclass(frozen=True, slots=True)
class Axis:
    """Перебираемый параметр: путь, диапазон включительно с обеих сторон и шаг."""

    path: str
    start: float
    stop: float
    step: float

    def __post_init__(self) -> None:
        kind = _describe(self.path)
        if not math.isfinite(self.start) or not math.isfinite(self.stop):
            raise AxisPathError(self.path, "границы диапазона оси должны быть конечными")
        if not math.isfinite(self.step) or self.step <= 0.0:
            raise AxisPathError(self.path, "шаг оси должен быть положительным числом")
        if self.stop < self.start:
            raise AxisPathError(self.path, "конец диапазона оси меньше начала")
        if kind is _LAUNCH_STAGE_KIND and any(
            not math.isclose(value, round(value), abs_tol=_STEP_TOLERANCE)
            for value in (self.start, self.stop, self.step)
        ):
            raise AxisPathError(
                self.path,
                "границы и шаг launch_stage должны быть целыми числами",
            )

    def values(self) -> tuple[float, ...]:
        """Значения оси в порядке возрастания исходного параметра.

        Углы приводятся к [0; 360), потому что сценарий вне этого диапазона ядро
        отвергает, а инженеру удобно задавать диапазон «340 — 380». Совпавшие после
        приведения значения схлопываются: диапазон в полный оборот дал бы две одинаковые
        точки на концах.
        """
        kind = _describe(self.path)
        span = self.stop - self.start
        count = math.floor(span / self.step + _STEP_TOLERANCE) + 1
        raw = (self.start + index * self.step for index in range(count))
        return _deduplicate(kind.normalize(value) for value in raw)


@dataclass(frozen=True, slots=True)
class Point:
    """Одна конфигурация сетки: значение по каждой оси.

    Значения лежат кортежем пар, а не отображением: точка обязана быть хэшируемой и
    сравнимой, а порядок осей задаёт порядок колонок heatmap.
    """

    values: tuple[tuple[str, float], ...]

    @property
    def params(self) -> dict[str, float]:
        """Точка в виде «путь -> значение» для хранения и ответа API."""
        return dict(self.values)


def grid(axes: Sequence[Axis], max_points: int) -> list[Point]:
    """Равномерная сетка по осям в детерминированном порядке.

    Первая ось меняется медленнее остальных: соседние точки списка отличаются значением
    последней оси, и heatmap заполняется строка за строкой.
    """
    if not axes:
        raise ValueError("нужна хотя бы одна ось")
    if max_points < 1:
        raise ValueError("бюджет точек должен быть положительным")
    paths = [axis.path for axis in axes]
    if len(set(paths)) != len(paths):
        raise ValueError("оси сетки повторяют один и тот же параметр")

    columns = [axis.values() for axis in axes]
    points_needed = math.prod(len(column) for column in columns)
    if points_needed > max_points:
        raise BudgetExceeded(points_needed, max_points)

    points: list[Point] = [Point(())]
    for path, column in zip(paths, columns, strict=True):
        points = [Point((*point.values, (path, value))) for point in points for value in column]
    return points


def apply_point(scenario: Mapping[str, object], point: Point) -> dict[str, object]:
    """Канонический сценарий точки. Входной словарь не меняется.

    Результат проходит через `scenario.parse`, поэтому точка либо даёт корректный
    сценарий, либо падает с теми же ошибками, что и загруженный файл: подстановка
    значения не должна создавать конфигурацию, которую API отказался бы принять.
    """
    draft: dict[str, Any] = copy.deepcopy(dict(scenario))
    for path, value in point.values:
        _describe(path).assign(draft, path, value)
    return to_dict(parse(draft))


# Значение оси приводится к допустимому виду перед подстановкой, а подстановка знает,
# в какое место сценария это значение положить.
_Normalizer: TypeAlias = Callable[[float], float]
_Assigner: TypeAlias = Callable[[dict[str, Any], str, float], None]


@dataclass(frozen=True, slots=True)
class _AxisKind:
    """Как обращаться со значениями конкретного вида оси."""

    normalize: _Normalizer
    assign: _Assigner


def _assign_angle(draft: dict[str, Any], path: str, value: float) -> None:
    match = _PLANE_AXIS.match(path)
    if match is None:
        raise AxisPathError(path, "путь не указывает на угол плоскости")
    plane = _locate_plane(draft, path, match.group("key"))
    plane[match.group("field")] = float(value)


def _assign_launch_stage(draft: dict[str, Any], path: str, value: float) -> None:
    design = draft.get("design")
    if not isinstance(design, dict):
        raise AxisPathError(path, "в сценарии нет раздела design")
    design["launch_stage"] = round(value)


def _locate_plane(draft: dict[str, Any], path: str, key: str) -> dict[str, Any]:
    """Плоскость по порядковому номеру или идентификатору."""
    design = draft.get("design")
    if not isinstance(design, dict):
        raise AxisPathError(path, "в сценарии нет раздела design")
    planes = design.get("planes")
    if not isinstance(planes, list):
        raise AxisPathError(path, "в сценарии нет списка плоскостей")

    if key.isdigit():
        index = int(key)
        if index >= len(planes):
            raise AxisPathError(path, f"в сценарии нет плоскости с номером {index}")
        found = planes[index]
    else:
        matching = [
            plane for plane in planes if isinstance(plane, dict) and str(plane.get("id")) == key
        ]
        if not matching:
            raise AxisPathError(path, f"в сценарии нет плоскости {key}")
        found = matching[0]
    if not isinstance(found, dict):
        raise AxisPathError(path, "плоскость записана не объектом")
    return found


def _launch_stage_value(value: float) -> float:
    """Этап запуска — целое число, а шаг оси приходит вещественным."""
    return float(round(value))


_ANGLE_KIND: Final[_AxisKind] = _AxisKind(normalize=normalize_angle_deg, assign=_assign_angle)
_LAUNCH_STAGE_KIND: Final[_AxisKind] = _AxisKind(
    normalize=_launch_stage_value,
    assign=_assign_launch_stage,
)


def _describe(path: str) -> _AxisKind:
    """Вид оси по её пути; неизвестный путь — ошибка запроса, а не пустая сетка.

    Перебирать разрешены только те параметры, которые перечислены на экране исследования:
    угол плоскости и этап запуска. Шаг сетки или горизонт по оси сравнивал бы между собой
    расчёты на разных сетках, а это запрещено постановкой (`01_SPEC.md` §7).
    """
    if path == LAUNCH_STAGE_PATH:
        return _LAUNCH_STAGE_KIND
    if _PLANE_AXIS.match(path) is not None:
        return _ANGLE_KIND
    raise AxisPathError(
        path,
        "ось задаётся путём design.planes[<id или номер>].raan_deg, "
        "design.planes[<id или номер>].phase_deg или design.launch_stage",
    )


def _deduplicate(values: Iterable[float]) -> tuple[float, ...]:
    """Совпавшие после нормализации значения в порядке первого появления."""
    unique: list[float] = []
    seen: set[float] = set()
    for value in values:
        key = round(value, _VALUE_DIGITS)
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return tuple(unique)


__all__ = [
    "LAUNCH_STAGE_PATH",
    "Axis",
    "AxisPathError",
    "BudgetExceeded",
    "Point",
    "apply_point",
    "grid",
]
