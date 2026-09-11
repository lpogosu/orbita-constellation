"""Данные для проверок контракта.

Идентификаторы намеренно не из сценариев кейса: API не знает ни про `S01`, ни про число
аппаратов в конкретном файле, и тесты не должны создавать такую зависимость.
"""

from typing import Any, Final

SAMPLE_UUID: Final[str] = "1f1d9b9a-6a26-4f0b-9c4f-9a2b4d5e6f70"
OTHER_UUID: Final[str] = "2a2e8c8b-7b37-4a1c-8d5e-0b3c5e6f7a81"

MINIMAL_SCENARIO: Final[dict[str, Any]] = {
    "schema_version": "cosmo-A-1.0",
    "meta": {"id": "contract-check", "title": "Проверка контракта"},
    "environment": {
        "altitude_km": 550.0,
        "inclination_deg": 87.0,
        "earth_angle0_deg": 0.0,
        "horizon_s": 3600,
        "step_s": 120,
        "min_elevation_deg": 10.0,
        "isl_range_km": 3000.0,
        "target_availability": 0.9,
    },
    "design": {
        "launch_stage": 1,
        "planes": [{"id": "PA", "raan_deg": 0.0, "phase_deg": 0.0}],
        "satellites": [
            {"id": "SAT1", "plane_id": "PA", "slot_deg": 0.0, "launch_batch": 1},
        ],
    },
    "ground_sites": [
        {
            "id": "CL1",
            "name": "Клиентский пункт",
            "role": "client",
            "lat_deg": 65.0,
            "lon_deg": 60.0,
        },
        {
            "id": "GW1",
            "name": "Шлюз",
            "role": "gateway",
            "lat_deg": 68.0,
            "lon_deg": 33.0,
        },
    ],
    "failures": [],
    "gateway_outages": [],
}
