"""Проверка рекомендованной конфигурации в условиях, в которых её не подбирали.

Запуск: `python docs/analysis/recommendation.py` (после `sweep_config.py`). Результат —
`results/recommendation.json`.

Лучшая точка перебора найдена на штатном сценарии, и одного этого мало: конфигурация,
выигравшая полпроцента в идеальных условиях, может проигрывать при отказах. Поэтому она
прогоняется ещё и в условиях сценариев 03 и 04 и проверяется на глубину отказа тем же
жадным поиском, что и база.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping
from typing import Any, Final

import common
from failure_depth import GREEDY_DEPTH, TARGET, greedy_worst_case

SWEEP_RESULT: Final[str] = "sweep"


def best_point() -> dict[str, float]:
    """Параметры лучшей точки уточняющего прохода `sweep_config.py`."""
    raw = json.loads((common.RESULTS_DIR / f"{SWEEP_RESULT}.json").read_text(encoding="utf-8"))
    params = raw["scan_2d_fine"]["best"]["params"]
    if not isinstance(params, dict):
        raise TypeError("лучшая точка перебора испорчена")
    return {str(key): float(value) for key, value in params.items()}


def apply_phases(base: Mapping[str, object], params: Mapping[str, float]) -> dict[str, Any]:
    """Сценарий с фазами плоскостей из рекомендованной точки.

    Разбирается путь оси `design.planes[<id>].phase_deg` — тот же формат, в котором
    `orbita_core.sweep` записывает точки сетки.
    """
    draft: dict[str, Any] = copy.deepcopy(dict(base))
    design = draft["design"]
    if not isinstance(design, dict):
        raise TypeError("design не является объектом")
    planes = design["planes"]
    if not isinstance(planes, list):
        raise TypeError("design.planes не является списком")
    for path, value in params.items():
        plane_id = path.split("[", 1)[1].split("]", 1)[0]
        field = path.rsplit(".", 1)[1]
        matched = [item for item in planes if isinstance(item, dict) and item.get("id") == plane_id]
        if not matched:
            raise KeyError(f"плоскость {plane_id} не найдена")
        matched[0][field] = value
    return draft


def outcome(draft: Mapping[str, object], label: str) -> dict[str, object]:
    result = common.run(common.parse(draft), common.DEFAULT_POLICY)
    config = result.aggregate.config
    # Отсчёты, на которых шлюз не видит ни одного аппарата, обрывают связь сразу всем
    # клиентам и задают общий потолок доступности: их число — отдельный показатель.
    gateway_blind = {
        gateway: round(
            (1.0 - common.site_visibility(result.plan, gateway)) * result.plan.ticks
        )
        for gateway in result.scenario.gateway_ids
    }
    return {
        "label": label,
        "gateway_blind_ticks": gateway_blind,
        "min_client_availability": config.min_client_availability,
        "mean_client_availability": config.mean_client_availability,
        "worst_max_gap_s": config.worst_max_gap_s,
        "mean_hops": config.mean_hops,
        "target_met_clients": list(config.target_met_clients),
        "availability": {item.client_id: item.availability for item in result.aggregate.clients},
        "max_gap_s": {item.client_id: item.max_gap_s for item in result.aggregate.clients},
    }


def under_conditions(params: Mapping[str, float]) -> dict[str, object]:
    """Рекомендованная конфигурация против исходной в условиях сценариев 01, 03 и 04.

    Условия берутся прямо из файлов кейса: отказы сценария 03 и дальность сценария 04
    подставляются вместе с рекомендованными фазами, чтобы разница была только в фазах.
    """
    rows: dict[str, object] = {}
    for source, label in (
        ("01_full_constellation", "штатные условия"),
        ("03_satellite_outages", "отказ десяти аппаратов с шестого часа"),
        ("04_link_range", "дальность ISL 2000 км"),
    ):
        conditions = common.load_dict(source)
        rows[source] = {
            "conditions": label,
            "base": outcome(conditions, f"исходные фазы, {label}"),
            "proposed": outcome(apply_phases(conditions, params), f"рекомендованные фазы, {label}"),
        }
    return rows


def main() -> None:
    base = common.load_dict("01_full_constellation")
    params = best_point()
    proposed = apply_phases(base, params)
    scenario = common.parse(proposed)
    satellite_ids = [item.id for item in scenario.satellites]
    horizon_s = scenario.environment.horizon_s

    path = common.write_json(
        "recommendation",
        {
            "description": (
                "Рекомендованная конфигурация: сверка с базой в трёх условиях и жадный "
                "поиск худшего набора отказов"
            ),
            "params": params,
            "target_availability": TARGET,
            "greedy_depth": GREEDY_DEPTH,
            "by_conditions": under_conditions(params),
            "greedy_worst_case": greedy_worst_case(proposed, satellite_ids, horizon_s),
        },
    )
    print(f"записано: {path}")


if __name__ == "__main__":
    main()
