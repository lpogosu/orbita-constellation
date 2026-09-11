"""Лексикографическое ранжирование конфигураций и рекомендация (ADR-006).

Один сводный балл скрыл бы компромисс между доступностью и длительностью перерыва, а
именно этот компромисс инженер и выбирает. Поэтому кандидаты сравниваются кортежем
показателей в фиксированном порядке важности, а рекомендация состоит из дельт по
конкретным метрикам и клиентам, не из текста: числа приходят из расчёта, LLM в v1 не
участвует (ADR-012).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from math import inf
from typing import Final

from orbita_core.metrics import ClientMetrics, ConfigMetrics
from orbita_core.scenario import Environment

# Порядок сравнения кандидатов; он же отдаётся в рекомендации, чтобы читающий видел, по
# какому правилу выбран вариант (`05_API.md` §1 `Recommendation.ranking_order`).
RANKING_ORDER: Final[tuple[str, ...]] = (
    "min_client_availability",
    "worst_max_gap_s",
    "mean_client_availability",
    "backup_path_count_min",
    "route_switches_total",
    "mean_hops",
)

# Изменённый параметр приходит готовым из слоя, который знает про Variant и его diff
# (`05_API.md` §1): ядро сравнивает метрики и не разбирает структуру сценария, поэтому
# запись параметра для него — непрозрачное отображение с ключами `path`, `from`, `to`.
ParameterChange = Mapping[str, object]


@dataclass(frozen=True, slots=True)
class RunConditions:
    """Условия расчёта, в которых получены метрики кандидата.

    Сравнение вариантов допустимо только при одинаковой сетке и сохранённых параметрах
    дальности и возвышения (`01_SPEC.md` §2.2, §7), а сами значения становятся границами
    применимости рекомендации.
    """

    step_s: int
    horizon_s: int
    isl_range_km: float
    min_elevation_deg: float
    target_availability: float

    @classmethod
    def from_environment(cls, environment: Environment) -> RunConditions:
        return cls(
            step_s=environment.step_s,
            horizon_s=environment.horizon_s,
            isl_range_km=environment.isl_range_km,
            min_elevation_deg=environment.min_elevation_deg,
            target_availability=environment.target_availability,
        )


@dataclass(frozen=True, slots=True)
class Candidate:
    """Конфигурация с посчитанными метриками и идентификатором запуска.

    Идентификатор для ядра непрозрачен: связывать его с Run и Variant — дело вызывающего
    слоя (ADR-001).
    """

    id: str
    config: ConfigMetrics
    clients: tuple[ClientMetrics, ...]
    conditions: RunConditions
    changed_parameters: tuple[ParameterChange, ...] = ()


@dataclass(frozen=True, slots=True)
class PerClientDelta:
    """Изменение показателей одного клиента относительно базового варианта."""

    client_id: str
    availability_delta: float
    max_gap_delta_s: int


@dataclass(frozen=True, slots=True)
class Recommendation:
    """Рекомендованная конфигурация, её дельты и границы применимости (`05_API.md` §1).

    `closest_run_id` и `availability_gap` заполняются только тогда, когда цель не
    достигнута ни одним кандидатом: в этом случае рекомендация обязана показать, насколько
    далеко лучшая из посчитанных точек от целевой доступности.
    """

    base_run_id: str
    recommended_run_id: str
    ranking_order: tuple[str, ...]
    changed_parameters: tuple[ParameterChange, ...]
    deltas: dict[str, float]
    per_client: tuple[PerClientDelta, ...]
    target_reached: bool
    limitations: tuple[str, ...]
    closest_run_id: str | None = None
    availability_gap: float | None = None
    ranked_run_ids: tuple[str, ...] = field(default_factory=tuple)


def _sort_key(candidate: Candidate) -> tuple[float, float, float, float, float, float]:
    """Кортеж сравнения `04_CORE.md` §6; меньше — лучше.

    Показатели, которые нужно максимизировать, берутся со знаком минус. Отсутствующее
    резервирование считается нулевым, а отсутствующее число переходов — бесконечным:
    вариант, в котором маршрута не было ни разу, не должен обойти вариант с маршрутами
    из-за пустого значения.
    """
    config = candidate.config
    backup = config.backup_path_count_min if config.backup_path_count_min is not None else 0
    return (
        -config.min_client_availability,
        float(config.worst_max_gap_s),
        -config.mean_client_availability,
        -float(backup),
        float(config.route_switches_total),
        config.mean_hops if config.mean_hops is not None else inf,
    )


def rank(candidates: Sequence[Candidate]) -> list[Candidate]:
    """Кандидаты в порядке предпочтения.

    Сортировка устойчива: кандидаты с одинаковым кортежем сохраняют исходный порядок,
    поэтому повторный вызов на тех же данных даёт тот же ответ (ADR-011).
    """
    return sorted(candidates, key=_sort_key)


def _limitations(conditions: RunConditions) -> tuple[str, ...]:
    """Границы применимости рекомендации из параметров расчёта.

    Каждая строка — значение, при котором получены метрики: за этими границами вывод не
    проверялся. Ничего сверх параметров сценария сюда не добавляется (ADR-012).
    """
    horizon = (
        f"{conditions.horizon_s // 3600} ч"
        if conditions.horizon_s % 3600 == 0
        else f"{conditions.horizon_s} с"
    )
    return (
        f"Проверено на сетке {conditions.step_s} с и горизонте {horizon}",
        f"Межспутниковая дальность {conditions.isl_range_km:g} км",
        f"Минимальный угол возвышения {conditions.min_elevation_deg:g}°",
    )


def _deltas(base: ConfigMetrics, best: ConfigMetrics) -> dict[str, float]:
    """Изменение метрик конфигурации относительно базовой.

    Метрика без значения хотя бы у одной стороны пропускается: разность с отсутствующим
    числом переходов означала бы, что сравнивать нечего.
    """
    deltas: dict[str, float] = {
        "min_client_availability": best.min_client_availability - base.min_client_availability,
        "worst_max_gap_s": float(best.worst_max_gap_s - base.worst_max_gap_s),
        "mean_client_availability": best.mean_client_availability - base.mean_client_availability,
        "route_switches_total": float(best.route_switches_total - base.route_switches_total),
    }
    if base.backup_path_count_min is not None and best.backup_path_count_min is not None:
        deltas["backup_path_count_min"] = float(
            best.backup_path_count_min - base.backup_path_count_min
        )
    if base.mean_hops is not None and best.mean_hops is not None:
        deltas["mean_hops"] = best.mean_hops - base.mean_hops
    return deltas


def _per_client(base: Candidate, best: Candidate) -> tuple[PerClientDelta, ...]:
    """Дельты по каждому клиенту в порядке базового варианта."""
    base_clients = {metrics.client_id: metrics for metrics in base.clients}
    best_clients = {metrics.client_id: metrics for metrics in best.clients}
    if base_clients.keys() != best_clients.keys():
        raise ValueError("сравниваются варианты с разным составом клиентских пунктов")
    return tuple(
        PerClientDelta(
            client_id=metrics.client_id,
            availability_delta=best_clients[metrics.client_id].availability - metrics.availability,
            max_gap_delta_s=best_clients[metrics.client_id].max_gap_s - metrics.max_gap_s,
        )
        for metrics in base.clients
    )


def recommend(base: Candidate, candidates: Sequence[Candidate]) -> Recommendation:
    """Лучший вариант относительно базового с дельтами и границами применимости.

    Базовый вариант участвует в ранжировании наравне с кандидатами: если ни один из них не
    лучше, рекомендацией становится он сам с нулевыми дельтами — это честный ответ
    «менять нечего», а не навязанное изменение.

    Условия расчёта у всех вариантов обязаны совпадать: сравнение на разной сетке или при
    разной дальности ISL сопоставляло бы разные задачи, а не конфигурации (`01_SPEC.md` §7).
    """
    pool = [base, *(candidate for candidate in candidates if candidate.id != base.id)]
    mismatched = [
        candidate.id for candidate in pool if candidate.conditions != base.conditions
    ]
    if mismatched:
        raise ValueError(f"условия расчёта отличаются от базовых у вариантов: {mismatched}")

    ordered = rank(pool)
    best = ordered[0]
    target = base.conditions.target_availability
    # Первый ключ сортировки — максимум минимальной доступности, поэтому лучший кандидат
    # одновременно и ближайший к цели: отдельного поиска ближайшей точки не требуется.
    target_reached = best.config.min_client_availability >= target
    return Recommendation(
        base_run_id=base.id,
        recommended_run_id=best.id,
        ranking_order=RANKING_ORDER,
        changed_parameters=best.changed_parameters,
        deltas=_deltas(base.config, best.config),
        per_client=_per_client(base, best),
        target_reached=target_reached,
        limitations=_limitations(base.conditions),
        closest_run_id=None if target_reached else best.id,
        availability_gap=None
        if target_reached
        else target - best.config.min_client_availability,
        ranked_run_ids=tuple(candidate.id for candidate in ordered),
    )
