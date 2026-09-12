"""Геометрия группировки: позиции, углы возвышения, межспутниковые линии.

Формулы взяты буквально из `01_SPEC.md` §2.1–2.5 и совпадают с официальным
`case/geometry/geometry.py`. Отличие одно: здесь всё считается сразу на всех отсчётах
сетки. Цикл по отсчётам в Python съедал бы больше времени, чем сам расчёт, а массив
позиций для группировки из нескольких десятков аппаратов занимает меньше мегабайта
(`04_CORE.md` §2).
"""

from __future__ import annotations

import math
from typing import Final

import numpy as np
from numpy.typing import NDArray

from orbita_core.scenario import Scenario

EARTH_RADIUS_KM: Final[float] = 6371.0
GRAVITATIONAL_PARAMETER_KM3_S2: Final[float] = 398600.435507
EARTH_ROTATION_PERIOD_S: Final[float] = 86164.09054
EARTH_ANGULAR_RATE_RAD_S: Final[float] = 2.0 * math.pi / EARTH_ROTATION_PERIOD_S

# Знаменатель проекции на отрезок, когда аппараты оказались в одной точке: по
# `01_SPEC.md` §2.5 в этом случае берётся ‖a‖, то есть q = 0. Значение совпадает с
# официальным модулем, чтобы результаты сходились бит в бит.
_DEGENERATE_SEGMENT_EPS: Final[float] = 1e-12


def positions_all(scenario: Scenario) -> NDArray[np.float64]:
    """Позиции всех аппаратов на всех отсчётах в земной системе, км.

    Форма массива `(ticks, N, 3)`, порядок аппаратов — `scenario.satellites`.
    Позиция считается для каждого аппарата независимо от его активности: отказавший
    аппарат остаётся на орбите и показывается на схеме (инвариант 14 `10_FIXTURES.md`).
    """
    environment = scenario.environment
    times_s = scenario.times_s
    orbit_radius_km = EARTH_RADIUS_KM + environment.altitude_km
    mean_motion_rad_s = math.sqrt(GRAVITATIONAL_PARAMETER_KM3_S2 / orbit_radius_km**3)
    inclination_rad = math.radians(environment.inclination_deg)

    argument_deg = np.array(
        [
            satellite.slot_deg + scenario.planes[plane_index].phase_deg
            for satellite, plane_index in zip(
                scenario.satellites, scenario.plane_of_satellite, strict=True
            )
        ],
        dtype=np.float64,
    )
    raan_rad = np.radians(
        np.array(
            [scenario.planes[index].raan_deg for index in scenario.plane_of_satellite],
            dtype=np.float64,
        )
    )

    argument_rad = np.radians(argument_deg)[None, :] + mean_motion_rad_s * times_s[:, None]
    cos_u = np.cos(argument_rad)
    sin_u = np.sin(argument_rad)
    cos_raan = np.cos(raan_rad)
    sin_raan = np.sin(raan_rad)
    cos_inclination = math.cos(inclination_rad)
    sin_inclination = math.sin(inclination_rad)

    x_inertial = orbit_radius_km * (cos_raan * cos_u - sin_raan * sin_u * cos_inclination)
    y_inertial = orbit_radius_km * (sin_raan * cos_u + cos_raan * sin_u * cos_inclination)
    z_inertial = orbit_radius_km * (sin_u * sin_inclination)

    earth_angle_rad = (
        math.radians(environment.earth_angle0_deg) + EARTH_ANGULAR_RATE_RAD_S * times_s
    )
    cos_theta = np.cos(earth_angle_rad)[:, None]
    sin_theta = np.sin(earth_angle_rad)[:, None]
    return np.stack(
        (
            cos_theta * x_inertial + sin_theta * y_inertial,
            -sin_theta * x_inertial + cos_theta * y_inertial,
            z_inertial,
        ),
        axis=-1,
    )


def ground_positions(scenario: Scenario) -> NDArray[np.float64]:
    """Позиции наземных пунктов в земной системе, км. Форма `(G, 3)`.

    Порядок — `scenario.ground_sites`. Земля сферическая, поэтому пункт неподвижен в
    земной системе и считается один раз на весь горизонт.
    """
    latitude_rad = np.radians(
        np.array([site.lat_deg for site in scenario.ground_sites], dtype=np.float64)
    )
    longitude_rad = np.radians(
        np.array([site.lon_deg for site in scenario.ground_sites], dtype=np.float64)
    )
    return EARTH_RADIUS_KM * np.stack(
        (
            np.cos(latitude_rad) * np.cos(longitude_rad),
            np.cos(latitude_rad) * np.sin(longitude_rad),
            np.sin(latitude_rad),
        ),
        axis=-1,
    )


def _site_to_satellite(
    satellite_positions: NDArray[np.float64], site_positions: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Векторы «пункт → аппарат» `(ticks, G, N, 3)` и их длины `(ticks, G, N)`."""
    delta = satellite_positions[:, None, :, :] - site_positions[None, :, None, :]
    distance_km = np.linalg.norm(delta, axis=3)
    return delta, distance_km


def slant_range_all(
    satellite_positions: NDArray[np.float64], site_positions: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Наклонные дальности «пункт — аппарат», км. Форма `(ticks, G, N)`."""
    return _site_to_satellite(satellite_positions, site_positions)[1]


def elevation_all(
    satellite_positions: NDArray[np.float64], site_positions: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Углы возвышения аппаратов над горизонтом пунктов, градусы. Форма `(ticks, G, N)`.

    `arcsin(((s − g)·g) / (‖s − g‖·R))` из `01_SPEC.md` §2.4. Аргумент арксинуса
    обрезается в [−1; 1]: без обрезки накопленная погрешность на почти надирном
    положении даёт NaN.
    """
    delta, distance_km = _site_to_satellite(satellite_positions, site_positions)
    site_normal = site_positions / EARTH_RADIUS_KM
    projection = np.einsum("tgnk,gk->tgn", delta, site_normal)
    elevation_deg: NDArray[np.float64] = np.degrees(
        np.arcsin(np.clip(projection / distance_km, -1.0, 1.0))
    )
    return elevation_deg


_ISL_PRUNING_MIN_SATELLITES: Final[int] = 128


def isl_pair_indices(
    satellite_count: int,
    *,
    positions: NDArray[np.float64] | None = None,
    isl_range_km: float | None = None,
    pruning_threshold: int = _ISL_PRUNING_MIN_SATELLITES,
) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    """Индексы неупорядоченных пар аппаратов `i < j`.

    Линия двунаправленная, поэтому хранится только верхний треугольник: пара учитывается
    один раз и не может появиться в contact plan дважды.  При переданных
    ``positions`` и ``isl_range_km`` для больших групп применяется безопасное
    AABB-pruning: пары, чьи траекторные bounding boxes уже дальше лимита,
    отбрасываются. Без этих аргументов функция сохраняет полную выборку.
    """
    first, second = np.triu_indices(satellite_count, 1)
    first = first.astype(np.int64)
    second = second.astype(np.int64)

    # For small constellations retain the historical full enumeration.  Apart
    # from avoiding overhead on the normal 48-satellite scenario, this makes
    # the optimisation an entirely transparent implementation detail.
    if (
        satellite_count < pruning_threshold
        or positions is None
        or isl_range_km is None
        or first.size == 0
    ):
        return first, second
    if positions.ndim != 3 or positions.shape[1:] != (satellite_count, 3):
        raise ValueError("positions must have shape (ticks, satellite_count, 3)")
    if positions.shape[0] == 0 or not math.isfinite(isl_range_km) or isl_range_km <= 0.0:
        return first, second

    # A satellite's sampled trajectory is enclosed by an axis-aligned box.
    # The distance between two boxes is a lower bound for the distance between
    # any two points in them.  Therefore a pair whose box gap is greater than
    # or equal to the strict ISL range can never satisfy d < range at any
    # simulation tick and may be safely omitted.  Process pairs in chunks so
    # the O(N^2) candidate set does not require another large temporary array.
    envelope_min = np.min(positions, axis=0)
    envelope_max = np.max(positions, axis=0)
    if not (np.isfinite(envelope_min).all() and np.isfinite(envelope_max).all()):
        return first, second
    keep = np.ones(first.size, dtype=np.bool_)
    chunk_size = 262_144
    for offset in range(0, first.size, chunk_size):
        end = min(offset + chunk_size, first.size)
        left = first[offset:end]
        right = second[offset:end]
        gap = np.maximum(
            0.0,
            np.maximum(
                envelope_min[right] - envelope_max[left],
                envelope_min[left] - envelope_max[right],
            ),
        )
        lower_bound = np.linalg.norm(gap, axis=1)
        # Equality is already invisible by the specification's strict '<'.
        keep[offset:end] = lower_bound < isl_range_km
    return first[keep], second[keep]


def isl_visible_all(
    satellite_positions: NDArray[np.float64],
    isl_range_km: float,
    pair_indices: tuple[NDArray[np.int64], NDArray[np.int64]] | None = None,
) -> tuple[NDArray[np.bool_], NDArray[np.float64]]:
    """Геометрическая доступность и длины межспутниковых линий на всех отсчётах.

    Возвращает маску `(ticks, P)` и расстояния `(ticks, P)` для пар из
    `isl_pair_indices`. Условие из `01_SPEC.md` §2.5: расстояние **строго меньше**
    `isl_range_km` (равенство дальности — уже не связь) и ближайшая к центру Земли точка
    отрезка лежит **строго выше** поверхности, иначе линия проходит сквозь планету.
    Активность аппаратов здесь не учитывается: она накладывается в `contacts`.
    """
    if pair_indices is None:
        first, second = isl_pair_indices(satellite_positions.shape[1])
    else:
        first, second = pair_indices
    start = satellite_positions[:, first, :]
    delta = satellite_positions[:, second, :] - start
    squared_length = np.einsum("tpk,tpk->tp", delta, delta)
    distance_km = np.sqrt(squared_length)

    # Пересечение Земли проверяется только там, где дальность уже подходит: таких пар
    # единицы процентов, и полный массив ближайших точек размера (ticks, P, 3) считать
    # незачем — он вдвое дороже всего остального расчёта.
    within_range = distance_km < isl_range_km
    segment_start = start[within_range]
    segment_delta = delta[within_range]
    # q ∈ [0; 1] — проекция центра Земли на отрезок; при совпадении координат q = 0 и
    # ближайшей точкой оказывается ‖a‖, как требует спецификация.
    projection = np.clip(
        -np.einsum("mk,mk->m", segment_start, segment_delta)
        / np.maximum(squared_length[within_range], _DEGENERATE_SEGMENT_EPS),
        0.0,
        1.0,
    )
    closest_km = np.linalg.norm(segment_start + projection[:, None] * segment_delta, axis=1)

    visible = np.zeros_like(within_range)
    visible[within_range] = closest_km > EARTH_RADIUS_KM
    return visible, distance_km
