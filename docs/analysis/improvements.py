"""Способы повышения устойчивости: что и на сколько поднимает доступность.

Запуск: `python docs/analysis/improvements.py`. Результат — `results/improvements.json`.

Каждая мера считается отдельно от остальных, от одной и той же базы — сценария 01.
Это не поиск оптимума, а оценка чувствительности: сколько процентных пунктов
доступности худшего клиента даёт каждый рычаг по отдельности, чтобы рекомендации
опирались на числа, а не на общие соображения.

Меры: второй шлюз, порог угла возвышения, наклонение орбит, число аппаратов в плоскости,
число плоскостей.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from typing import Any, Final

import common

# Площадки второго шлюза. Точки выбраны по долготе клиентских пунктов (60°, 90°, 130°):
# единственный шлюз стоит на 33° в. д., и восточные клиенты выходят на него через всю
# группировку. Широты — материковая Арктика, как и у существующего шлюза.
SECOND_GATEWAYS: Final[tuple[tuple[str, float, float], ...]] = (
    ("G_NOR", 69.35, 88.20),
    ("G_TIK", 71.63, 128.87),
    ("G_ANA", 64.73, 177.51),
)

ELEVATIONS_DEG: Final[tuple[float, ...]] = (5.0, 10.0, 15.0, 20.0)
INCLINATIONS_DEG: Final[tuple[float, ...]] = (75.0, 80.0, 85.0, 87.0, 90.0, 95.0)
PLANE_SIZES: Final[tuple[int, ...]] = (12, 16, 20, 24)
PLANE_COUNTS: Final[tuple[int, ...]] = (3, 4, 6)

FULL_TURN_DEG: Final[float] = 360.0


def outcome(draft: Mapping[str, object], label: str, **extra: object) -> dict[str, object]:
    """Один вариант: полный расчёт и те показатели, что идут в таблицу документа."""
    result = common.run(common.parse(draft), common.DEFAULT_POLICY)
    config = result.aggregate.config
    return {
        "label": label,
        **extra,
        "min_client_availability": config.min_client_availability,
        "mean_client_availability": config.mean_client_availability,
        "worst_max_gap_s": config.worst_max_gap_s,
        "mean_hops": config.mean_hops,
        "target_met_clients": list(config.target_met_clients),
        "availability": {item.client_id: item.availability for item in result.aggregate.clients},
    }


def second_gateway(base: Mapping[str, object]) -> list[dict[str, object]]:
    """Тот же проект плюс один дополнительный шлюз."""
    rows: list[dict[str, object]] = []
    for site_id, lat_deg, lon_deg in SECOND_GATEWAYS:
        draft: dict[str, Any] = copy.deepcopy(dict(base))
        sites = draft["ground_sites"]
        if not isinstance(sites, list):
            raise TypeError("ground_sites не является списком")
        sites.append(
            {
                "id": site_id,
                "name": f"Second gateway {site_id} (synthetic installation)",
                "role": "gateway",
                "lat_deg": lat_deg,
                "lon_deg": lon_deg,
            }
        )
        rows.append(outcome(draft, site_id, lat_deg=lat_deg, lon_deg=lon_deg))
    return rows


def environment_axis(
    base: Mapping[str, object], key: str, values: Sequence[float]
) -> list[dict[str, object]]:
    """Перебор одного параметра окружения: возвышение, наклонение."""
    rows: list[dict[str, object]] = []
    for value in values:
        draft: dict[str, Any] = copy.deepcopy(dict(base))
        environment = draft["environment"]
        if not isinstance(environment, dict):
            raise TypeError("environment не является объектом")
        environment[key] = value
        rows.append(outcome(draft, f"{key}={value:g}", **{key: value}))
    return rows


def build_design(
    plane_count: int, plane_size: int, raan_step_deg: float, phase_step_deg: float
) -> dict[str, Any]:
    """Проект из равномерно разнесённых плоскостей с равномерными слотами.

    Плоскости получают долготы восходящего узла с постоянным шагом, а фазы — сдвиг,
    кратный номеру плоскости: так строится исходный проект кейса (0°, 60°, 120° и 0°,
    7,5°, 15°), и варианты остаются сравнимыми с ним.

    Партия запуска у всех аппаратов последняя из трёх: расчёт идёт на полностью
    развёрнутой группировке, а этап развёртывания разбирается отдельным скриптом.
    """
    slot_step_deg = FULL_TURN_DEG / plane_size
    planes: list[dict[str, object]] = []
    satellites: list[dict[str, object]] = []
    for plane_index in range(plane_count):
        plane_id = f"P{plane_index + 1}"
        planes.append(
            {
                "id": plane_id,
                "raan_deg": (plane_index * raan_step_deg) % FULL_TURN_DEG,
                "phase_deg": (plane_index * phase_step_deg) % FULL_TURN_DEG,
            }
        )
        for slot_index in range(plane_size):
            satellites.append(
                {
                    "id": f"S{len(satellites) + 1:03d}",
                    "plane_id": plane_id,
                    "slot_deg": slot_index * slot_step_deg,
                    "launch_batch": 3,
                }
            )
    return {"launch_stage": 3, "planes": planes, "satellites": satellites}


def constellation_size(base: Mapping[str, object]) -> dict[str, object]:
    """Число аппаратов в плоскости и число плоскостей при том же шаге RAAN и фазы."""
    by_plane_size: list[dict[str, object]] = []
    for plane_size in PLANE_SIZES:
        draft: dict[str, Any] = copy.deepcopy(dict(base))
        draft["design"] = build_design(3, plane_size, 60.0, 7.5)
        by_plane_size.append(
            outcome(
                draft,
                f"3 плоскости x {plane_size}",
                plane_count=3,
                plane_size=plane_size,
                satellite_count=3 * plane_size,
            )
        )

    by_plane_count: list[dict[str, object]] = []
    for plane_count in PLANE_COUNTS:
        # Плоскости разносятся по полуобороту: при наклонении около 90° плоскости с
        # долготами узла, отличающимися на 180°, лежат в одной и той же плоскости орбиты.
        raan_step_deg = 180.0 / plane_count
        plane_size = 48 // plane_count
        draft = copy.deepcopy(dict(base))
        draft["design"] = build_design(plane_count, plane_size, raan_step_deg, 7.5)
        by_plane_count.append(
            outcome(
                draft,
                f"{plane_count} плоскости x {plane_size}",
                plane_count=plane_count,
                plane_size=plane_size,
                satellite_count=plane_count * plane_size,
                raan_step_deg=raan_step_deg,
            )
        )
    return {"by_plane_size": by_plane_size, "by_plane_count": by_plane_count}


def main() -> None:
    base = common.load_dict("01_full_constellation")
    baseline = outcome(base, "база 01_full_constellation")

    path = common.write_json(
        "improvements",
        {
            "description": (
                "Чувствительность доступности к отдельным мерам на базе сценария 01, "
                "политика bfs_shortest"
            ),
            "baseline": baseline,
            "second_gateway": second_gateway(base),
            "min_elevation": environment_axis(base, "min_elevation_deg", ELEVATIONS_DEG),
            "inclination": environment_axis(base, "inclination_deg", INCLINATIONS_DEG),
            "constellation_size": constellation_size(base),
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
