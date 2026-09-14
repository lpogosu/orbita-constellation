"""Перебор ориентации плоскостей и фазирования: есть ли конфигурация лучше исходной.

Запуск: `python docs/analysis/sweep_config.py`. Результат — `results/sweep.json`.

Сначала шесть одномерных проходов — долгота восходящего узла и фаза каждой из трёх
плоскостей, шаг 15°, по 24 точки. Затем двумерная сетка 12×12 (шаг 30°) по двум осям,
которые в одномерном проходе дали лучший результат. Критерий — доступность худшего
клиента, при равенстве — его максимальный перерыв: это первые два члена
`ranking.RANKING_ORDER`, по которым ядро сравнивает варианты.

Исходная точка сценария 01 входит в каждую сетку: RAAN плоскостей 0°, 60°, 120° кратны
15° и 30°, фазы 0° и 15° тоже, а фаза 7,5° плоскости P2 добавлена в её ось отдельно,
иначе прогон не мог бы вернуть исходную конфигурацию.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Final

import common
from orbita_core import sweep

PLANE_IDS: Final[tuple[str, ...]] = ("P1", "P2", "P3")
FIELDS: Final[tuple[str, ...]] = ("raan_deg", "phase_deg")

STEP_1D_DEG: Final[float] = 15.0
STEP_2D_DEG: Final[float] = 30.0
FULL_TURN_DEG: Final[float] = 360.0

# На сколько частей делится период фазы в уточняющем проходе: 12 делений дают ту же
# сетку 12×12, что и грубый двумерный проход, но внутри одного периода.
FINE_DIVISIONS: Final[float] = 12.0


def axis_path(plane_id: str, field: str) -> str:
    return f"design.planes[{plane_id}].{field}"


def evaluate(base: Mapping[str, object], point: sweep.Point) -> dict[str, object]:
    """Одна точка сетки: подстановка значений и полный расчёт суток."""
    result = common.run(sweep.apply_point(base, point), common.DEFAULT_POLICY)
    config = result.aggregate.config
    return {
        "params": point.params,
        "min_client_availability": config.min_client_availability,
        "mean_client_availability": config.mean_client_availability,
        "worst_max_gap_s": config.worst_max_gap_s,
        "mean_hops": config.mean_hops,
        "route_switches_total": config.route_switches_total,
        "availability": {
            item.client_id: item.availability for item in result.aggregate.clients
        },
    }


def quality(row: Mapping[str, object]) -> tuple[float, float]:
    """Ключ сравнения точек: сначала доступность худшего клиента, потом его перерыв.

    Возвращается кортеж «меньше — лучше», как в `ranking._sort_key`, чтобы порядок
    точек здесь и порядок вариантов в ядре не разошлись.
    """
    availability = row["min_client_availability"]
    gap = row["worst_max_gap_s"]
    if not isinstance(availability, float) or not isinstance(gap, int):
        raise TypeError("строка сетки испорчена")
    return (-availability, float(gap))


def extra_values(base: Mapping[str, object], plane_id: str, field: str) -> tuple[float, ...]:
    """Исходное значение параметра, если сетка с постоянным шагом в него не попадает."""
    design = base["design"]
    if not isinstance(design, dict):
        raise TypeError("design сценария не является объектом")
    planes = design["planes"]
    if not isinstance(planes, list):
        raise TypeError("design.planes не является списком")
    for plane in planes:
        if isinstance(plane, dict) and plane.get("id") == plane_id:
            value = plane[field]
            if not isinstance(value, int | float):
                raise TypeError(f"{plane_id}.{field} не является числом")
            return (float(value),) if float(value) % STEP_1D_DEG != 0.0 else ()
    raise KeyError(f"плоскость {plane_id} не найдена")


def scan_1d(base: Mapping[str, object]) -> dict[str, object]:
    """Шесть одномерных проходов по осям плоскостей."""
    axes: dict[str, object] = {}
    for plane_id in PLANE_IDS:
        for field in FIELDS:
            path = axis_path(plane_id, field)
            axis = sweep.Axis(
                path=path,
                start=0.0,
                stop=FULL_TURN_DEG - STEP_1D_DEG,
                step=STEP_1D_DEG,
            )
            values = [*axis.values(), *extra_values(base, plane_id, field)]
            points = [sweep.Point(((path, value),)) for value in sorted(set(values))]
            rows = [evaluate(base, point) for point in points]
            rows.sort(key=quality)
            axes[path] = {"point_count": len(rows), "best": rows[0], "rows": rows}
    return axes


def best_axes(axes: Mapping[str, object]) -> tuple[str, str]:
    """Две оси с лучшим одномерным результатом — по ним строится двумерная сетка."""

    def axis_quality(path: str) -> tuple[float, float, str]:
        entry = axes[path]
        if not isinstance(entry, dict):
            raise TypeError("запись оси испорчена")
        best = entry["best"]
        if not isinstance(best, dict):
            raise TypeError("лучшая точка оси испорчена")
        return (*quality(best), path)

    ordered = sorted(axes, key=axis_quality)
    return ordered[0], ordered[1]


def scan_2d(
    base: Mapping[str, object], paths: Sequence[str], *, span_deg: float, step_deg: float
) -> dict[str, object]:
    """Двумерная сетка по выбранной паре осей."""
    axes = [
        sweep.Axis(path=path, start=0.0, stop=span_deg - step_deg, step=step_deg)
        for path in paths
    ]
    points = sweep.grid(axes, max_points=200)
    rows = [evaluate(base, point) for point in points]
    rows.sort(key=quality)
    return {
        "axes": list(paths),
        "span_deg": span_deg,
        "step_deg": step_deg,
        "point_count": len(rows),
        "best": rows[0],
        "rows": rows,
    }


def slot_spacing_deg(base: Mapping[str, object]) -> float:
    """Угловой шаг между соседними слотами плоскости.

    Фаза плоскости сдвигает все её аппараты сразу, а слоты расставлены равномерно,
    поэтому сдвиг ровно на один шаг слота переводит плоскость саму в себя: фаза точно
    периодична с этим периодом. Сетка с шагом 15° видит внутри периода 22,5° всего три
    значения, и уточняющий проход идёт уже по одному периоду.
    """
    scenario = common.parse(base)
    slots = sorted({item.slot_deg for item in scenario.satellites if item.plane_id == "P1"})
    if len(slots) < 2:
        raise ValueError("в плоскости меньше двух аппаратов")
    return slots[1] - slots[0]


def best_phase_axes(axes: Mapping[str, object]) -> tuple[str, str]:
    """Две фазовые оси с лучшим одномерным результатом."""

    def axis_quality(path: str) -> tuple[float, float, str]:
        entry = axes[path]
        if not isinstance(entry, dict):
            raise TypeError("запись оси испорчена")
        best = entry["best"]
        if not isinstance(best, dict):
            raise TypeError("лучшая точка оси испорчена")
        return (*quality(best), path)

    ordered = sorted((path for path in axes if path.endswith("phase_deg")), key=axis_quality)
    return ordered[0], ordered[1]


def main() -> None:
    base = common.load_dict("01_full_constellation")
    baseline = common.run(common.parse(base), common.DEFAULT_POLICY).aggregate.config
    axes = scan_1d(base)
    grid = scan_2d(
        base, best_axes(axes), span_deg=FULL_TURN_DEG, step_deg=STEP_2D_DEG
    )
    period_deg = slot_spacing_deg(base)
    fine = scan_2d(
        base,
        best_phase_axes(axes),
        span_deg=period_deg,
        step_deg=period_deg / FINE_DIVISIONS,
    )

    path = common.write_json(
        "sweep",
        {
            "description": (
                "Перебор RAAN и фазы плоскостей на сценарии 01, критерий minimax, "
                "политика bfs_shortest"
            ),
            "baseline": {
                "min_client_availability": baseline.min_client_availability,
                "mean_client_availability": baseline.mean_client_availability,
                "worst_max_gap_s": baseline.worst_max_gap_s,
                "mean_hops": baseline.mean_hops,
                "route_switches_total": baseline.route_switches_total,
            },
            "scan_1d": axes,
            "scan_2d": grid,
            "scan_2d_fine": fine,
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
