"""Метрики, перерывы связи, сравнение, рекомендация и выгрузка (`05_API.md` §1, §5)."""

from typing import Final
from uuid import UUID

from pydantic import BaseModel, Field

from orbita_api.schemas.common import (
    OutageCause,
    OutageChangeKind,
    ParameterChange,
    RoutingPolicy,
)
from orbita_api.schemas.scenario import Scenario

RESULT_SCHEMA_VERSION: Final[str] = "cosmo-A-result-1.0"


class OutageInterval(BaseModel):
    """Непрерывный период без маршрута с доказательствами причины (ADR-005)."""

    client_id: str
    start_s: int
    end_s: int = Field(description="Конец интервала исключительно")
    duration_s: int
    truncated_by_horizon: bool = Field(
        description="Перерыв примыкает к началу или концу горизонта (ADR-004)",
    )
    primary_cause: OutageCause
    causes: list[OutageCause] = Field(description="Все сработавшие причины")
    client_visible_satellites: list[str]
    gateway_visible_satellites: list[str]
    failed_satellites: list[str]
    client_component_id: int | None = Field(
        default=None,
        description="Компонента связности спутников клиента; null, если спутников нет",
    )
    gateway_component_id: int | None = None
    last_path: list[str] = Field(description="Последний рабочий маршрут перед перерывом")
    next_path: list[str] = Field(description="Первый рабочий маршрут после перерыва")


class ClientMetrics(BaseModel):
    """Показатели одного клиентского пункта за горизонт (`04_CORE.md` §5.1)."""

    client_id: str
    availability: float = Field(description="Доля отсчётов с маршрутом, [0; 1]")
    visibility: float = Field(description="Доля отсчётов с видимым активным спутником")
    max_gap_s: int
    # Переходы считаются только по отсчётам с маршрутом: у клиента без единого маршрута
    # значения нет, и ноль тут был бы ложью.
    mean_hops: float | None = None
    max_hops: int | None = None
    route_switches: int
    target_met: bool = Field(description="`availability >= target_availability`")
    outage_count_by_cause: dict[OutageCause, int]


class ConfigMetrics(BaseModel):
    """Показатели конфигурации целиком (`04_CORE.md` §5.2)."""

    min_client_availability: float
    mean_client_availability: float
    worst_max_gap_s: int
    mean_hops: float | None = None
    max_hops: int | None = None
    route_switches_total: int
    backup_path_count_min: int | None = Field(
        default=None,
        description="Минимум по клиентам и отсчётам с маршрутом; null, если не считался",
    )
    outage_count_by_cause: dict[OutageCause, int] = Field(
        description="Число перерывов по каждой причине, суммарно по клиентам",
    )
    target_met_clients: list[str]


class RunMetrics(BaseModel):
    """Ответ `GET /api/runs/{id}/metrics`."""

    run_id: UUID
    clients: list[ClientMetrics]
    config: ConfigMetrics


class ClientDelta(BaseModel):
    """Изменение показателей одного клиента между двумя запусками."""

    client_id: str
    availability_delta: float
    max_gap_delta_s: int


class OutageChange(BaseModel):
    """Один перерыв, которого не было, не стало или у которого сдвинулись границы.

    У появившегося перерыва нет базовых границ, у исчезнувшего — сравниваемых. Причина и
    отказавшие аппараты описывают ту сторону, чей перерыв показан: для появившегося и
    изменившегося это расчёт «после», для исчезнувшего — базовый, другой стороны у него
    нет.
    """

    kind: OutageChangeKind
    base_start_s: int | None = Field(default=None, description="Начало перерыва «до»")
    base_end_s: int | None = Field(default=None, description="Конец перерыва «до», исключая")
    other_start_s: int | None = Field(default=None, description="Начало перерыва «после»")
    other_end_s: int | None = Field(
        default=None,
        description="Конец перерыва «после», исключая",
    )
    primary_cause: OutageCause
    causes: list[OutageCause]
    failed_satellites: list[str]


class ClientComparison(ClientDelta):
    """Что изменилось у клиентского пункта между базовым запуском и сравниваемым.

    Расширяет дельты метрик разбором перерывов: экран «Отказы» показывает по каждому
    клиенту не только «стало хуже на столько-то», но и какой именно перерыв появился,
    где маршрут уцелел и с какого момента результаты разошлись (`14_SCREENS.md` §3.3).
    """

    outage_diff: list[OutageChange]
    affected: bool = Field(
        description="Появился или изменился перерыв либо упала доступность",
    )
    route_kept_ticks: int = Field(description="Отсчёты, где маршрут совпал узел в узел")
    route_rebuilt_ticks: int = Field(description="Отсчёты, где маршрут есть, но другой")
    first_divergence_t_s: int | None = Field(
        default=None,
        description="Первый отсчёт, где результат «после» отличается от «до»",
    )
    first_new_outage_t_s: int | None = Field(
        default=None,
        description="Первый отсчёт, где маршрут был до изменения и пропал после",
    )


class Recommendation(BaseModel):
    """Детерминированный вывод из метрик (ADR-006)."""

    base_run_id: UUID
    recommended_run_id: UUID
    ranking_order: list[str] = Field(
        description="Метрики в порядке лексикографического сравнения кандидатов",
    )
    changed_parameters: list[ParameterChange]
    deltas: dict[str, float] = Field(description="Изменение метрики конфигурации по имени")
    per_client: list[ClientDelta]
    target_reached: bool
    limitations: list[str] = Field(
        description="Условия, за пределами которых вывод не проверялся",
    )


class ComparisonRequest(BaseModel):
    """Тело `POST /api/comparisons`."""

    run_ids: list[UUID] = Field(min_length=2, description="Сравниваются минимум два запуска")


class ComparisonEntry(BaseModel):
    """Один запуск в сравнении: метрики, отличия от базового и изменённые параметры."""

    run_id: UUID
    variant_id: UUID
    variant_title: str
    routing_policy: RoutingPolicy
    config: ConfigMetrics
    clients: list[ClientMetrics]
    changed_parameters: list[ParameterChange] = Field(
        description="Отличия сценария от базового запуска; у базового пусто",
    )
    deltas: dict[str, float] = Field(
        description="Отличия метрик конфигурации от базового запуска; у базового пусто",
    )
    per_client: list[ClientComparison] = Field(
        description="Отличия по каждому клиентскому пункту; у базового пусто",
    )
    affected_clients: list[str] = Field(
        description="Пункты с новыми или изменившимися перерывами; у базового пусто",
    )
    first_divergence_t_s: int | None = Field(
        default=None,
        description="Самый ранний отсчёт расхождения по всем пунктам; у базового null",
    )


class ComparisonResult(BaseModel):
    """Ответ `POST /api/comparisons`. Базовым считается первый запуск списка."""

    base_run_id: UUID
    entries: list[ComparisonEntry]


class RouteRecord(BaseModel):
    """Маршрут одного клиента на одном отсчёте (`01_SPEC.md` §8)."""

    t_s: int
    client_id: str
    path: list[str] = Field(description="Пустой список означает отсутствие маршрута")


class RunExport(BaseModel):
    """Выгрузка результата `cosmo-A-result-1.0` (`01_SPEC.md` §8, `05_API.md` §5)."""

    schema_version: str = RESULT_SCHEMA_VERSION
    effective_scenario: Scenario = Field(
        description="Полный сценарий, использованный в расчёте, включая правки пользователя",
    )
    routes: list[RouteRecord] = Field(
        description="Ровно одна запись на пару «отсчёт - клиент»",
    )
    run_id: UUID
    engine_version: str
    routing_policy: RoutingPolicy
    metrics: RunMetrics
    outages: list[OutageInterval]
    recommendation: Recommendation | None = None


class SatelliteCriticality(BaseModel):
    """Вклад одного аппарата в устойчивость конфигурации (`04_CORE.md` §5.3)."""

    satellite_id: str
    delta_min_client_availability: float = Field(
        description="Изменение min_client_availability при отказе аппарата на весь горизонт",
    )
    delta_worst_max_gap_s: int = Field(
        description="Изменение worst_max_gap_s при том же отказе",
    )
    affected_clients: list[str]
    min_cut_frequency: float = Field(
        description="Доля отсчётов, где аппарат входит в минимальный разрез, [0; 1]",
    )


class CriticalityRequest(BaseModel):
    """Тело `POST /api/analysis/criticality`."""

    run_id: UUID


class CriticalityReport(BaseModel):
    """Resilience X-Ray: аппараты по убыванию влияния на метрики (ADR-007)."""

    run_id: UUID
    satellites: list[SatelliteCriticality]
