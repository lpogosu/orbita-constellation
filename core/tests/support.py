"""Пути к данным, загрузка эталонного модуля и синтетические сценарии для тестов."""

from __future__ import annotations

import importlib.util
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import ModuleType
from typing import Any, Final

import numpy as np

from orbita_core.contacts import ContactPlan, EdgeKind

REPO_ROOT: Final[Path] = Path(__file__).resolve().parents[2]
SCENARIOS_DIR: Final[Path] = REPO_ROOT / "scenarios"
FIXTURES_DIR: Final[Path] = Path(__file__).resolve().parent / "fixtures"
REFERENCE_MODULE_PATH: Final[Path] = REPO_ROOT / "Расчетный модуль" / "geometry.py"

SCENARIO_PATHS: Final[tuple[Path, ...]] = tuple(sorted(SCENARIOS_DIR.glob("*.json")))

# Отсчёты сверки с эталоном: начало сетки, второй отсчёт, середина суток и последний
# отсчёт горизонта (`10_FIXTURES.md` §4).
CROSSCHECK_TIMES_S: Final[tuple[int, ...]] = (0, 120, 43200, 86280)


def load_reference_geometry() -> ModuleType:
    """Официальный `Расчетный модуль/geometry.py` как модуль.

    Он лежит вне пакета и вне `sys.path`, поэтому загружается по абсолютному пути.
    Ядро на него не ссылается: модуль нужен только как эталон формул в тестах.
    """
    spec = importlib.util.spec_from_file_location("reference_geometry", REFERENCE_MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"не удалось загрузить эталонный модуль: {REFERENCE_MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> dict[str, Any]:
    """Читает JSON как есть, без валидации: тесту нужен и заведомо неверный вход."""
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def synthetic_scenario(
    *,
    satellite_count: int = 8,
    launch_batches: Sequence[int] | None = None,
    launch_stage: int = 3,
    horizon_s: int = 7200,
    step_s: int = 120,
    min_elevation_deg: float = 10.0,
    isl_range_km: float = 3000.0,
    inclination_deg: float = 87.0,
    failures: Sequence[Mapping[str, object]] = (),
    gateway_outages: Sequence[Mapping[str, object]] = (),
) -> dict[str, Any]:
    """Маленький сценарий с идентификаторами, которых нет в кейсе (ADR-015).

    Две плоскости и северные пункты: на коротком горизонте так гарантированно есть и
    наземные контакты у обоих пунктов, и межспутниковые линии.
    """
    batches = list(launch_batches) if launch_batches is not None else [1] * satellite_count
    planes = ("ORB-A", "ORB-B")
    return {
        "schema_version": "cosmo-A-1.0",
        "meta": {"id": "synthetic", "title": "Синтетический сценарий"},
        "environment": {
            "altitude_km": 550.0,
            "inclination_deg": inclination_deg,
            "earth_angle0_deg": 12.0,
            "horizon_s": horizon_s,
            "step_s": step_s,
            "min_elevation_deg": min_elevation_deg,
            "isl_range_km": isl_range_km,
            "target_availability": 0.9,
        },
        "design": {
            "launch_stage": launch_stage,
            "planes": [
                {"id": planes[0], "raan_deg": 0.0, "phase_deg": 0.0},
                {"id": planes[1], "raan_deg": 90.0, "phase_deg": 7.5},
            ],
            "satellites": [
                {
                    "id": f"SAT-{index:02d}",
                    "plane_id": planes[index % len(planes)],
                    "slot_deg": 360.0 * index / satellite_count,
                    "launch_batch": batches[index],
                }
                for index in range(satellite_count)
            ],
        },
        "ground_sites": [
            {
                "id": "GW-NORTH",
                "name": "Северный шлюз",
                "role": "gateway",
                "lat_deg": 69.0,
                "lon_deg": 33.0,
            },
            {
                "id": "TERM-EAST",
                "name": "Восточный терминал",
                "role": "client",
                "lat_deg": 70.0,
                "lon_deg": 90.0,
            },
        ],
        "failures": [dict(item) for item in failures],
        "gateway_outages": [dict(item) for item in gateway_outages],
    }


def single_tick_plan(
    *,
    satellite_count: int,
    gateway_count: int,
    client_count: int,
    links: Sequence[tuple[int, int, float]],
    gateway_available: Sequence[bool],
) -> ContactPlan:
    """Contact plan из произвольного графа на одном отсчёте.

    Нужен property-тестам: сценарий с заданной топологией через орбитальную геометрию не
    построить, а маршрутизация от геометрии и не зависит — ей достаточно узлов, рёбер и
    ролей. Ребро задаётся как `(узел, узел, длина)` в том же порядке, что в
    `contacts.build`: первым идёт аппарат, вторым аппарат или наземный пункт.
    """
    node_ids = (
        tuple(f"SAT-{index:02d}" for index in range(satellite_count))
        + tuple(f"GW-{index}" for index in range(gateway_count))
        + tuple(f"TRM-{index}" for index in range(client_count))
    )
    edges = np.array([[first, second] for first, second, _ in links], dtype=np.int64)
    return ContactPlan(
        nodes=node_ids,
        node_index={node_id: index for index, node_id in enumerate(node_ids)},
        satellite_count=satellite_count,
        step_s=120,
        edges=edges.reshape(-1, 2),
        kinds=tuple(
            EdgeKind.ISL if second < satellite_count else EdgeKind.GROUND
            for _, second, _ in links
        ),
        bits=np.ones((1, len(links)), dtype=np.bool_),
        dist=np.array([[length for _, _, length in links]], dtype=np.float64).reshape(1, -1),
        active=np.ones((1, satellite_count), dtype=np.bool_),
        gateway_ids=node_ids[satellite_count : satellite_count + gateway_count],
        gateway_available=np.array([list(gateway_available)], dtype=np.bool_),
        positions=np.zeros((1, satellite_count, 3), dtype=np.float64),
    )
