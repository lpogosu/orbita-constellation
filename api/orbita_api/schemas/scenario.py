"""Входной сценарий `cosmo-A-1.0` (`01_SPEC.md` §3).

Здесь описаны только типы и обязательность полей: диапазоны значений, уникальность
идентификаторов, разрешение ссылок и кратность сетки проверяет ядро
(`04_CORE.md` §2, `01_SPEC.md` §3.1). Дублировать эти правила в HTTP-слое нельзя - тогда
одна и та же ошибка получила бы два разных кода и два разных сообщения.
"""

from typing import Final

from pydantic import BaseModel, Field

from orbita_api.schemas.common import SiteRole

SCENARIO_SCHEMA_VERSION: Final[str] = "cosmo-A-1.0"


class ScenarioMeta(BaseModel):
    id: str = Field(description="Идентификатор сценария из файла")
    title: str = Field(description="Название сценария")


class Environment(BaseModel):
    """Параметры расчёта: орбита, сетка времени и условия связи."""

    altitude_km: float
    inclination_deg: float
    earth_angle0_deg: float = Field(
        description="Угол поворота Земли в начале расчёта, градусы",
    )
    horizon_s: int = Field(description="Продолжительность расчёта, секунды")
    step_s: int = Field(description="Шаг сетки времени, секунды")
    min_elevation_deg: float = Field(
        description="Минимальный угол возвышения для наземного контакта",
    )
    isl_range_km: float = Field(description="Предельная дальность межспутниковой линии")
    target_availability: float = Field(
        description="Целевая доля отсчётов с маршрутом для каждого клиента, [0; 1]",
    )


class Plane(BaseModel):
    id: str
    raan_deg: float = Field(description="Прямое восхождение восходящего узла, [0; 360)")
    phase_deg: float = Field(description="Общий сдвиг спутников плоскости, [0; 360)")


class Satellite(BaseModel):
    id: str
    plane_id: str
    slot_deg: float = Field(description="Начальное угловое положение в плоскости")
    launch_batch: int = Field(description="Очередь запуска: 1, 2 или 3")


class Design(BaseModel):
    launch_stage: int = Field(description="Сколько очередей запущено: 1, 2 или 3")
    planes: list[Plane]
    satellites: list[Satellite]


class GroundSite(BaseModel):
    id: str
    name: str
    role: SiteRole
    lat_deg: float
    lon_deg: float
    min_elevation_deg: float | None = Field(
        default=None,
        description=(
            "Локальный минимальный угол возвышения для наземных контактов; "
            "если не задан, используется environment.min_elevation_deg"
        ),
    )


class SatelliteFailure(BaseModel):
    """Интервал недоступности аппарата `[start_s; end_s)`."""

    satellite_id: str
    start_s: int
    end_s: int


class GatewayOutage(BaseModel):
    """Интервал недоступности шлюза `[start_s; end_s)`."""

    gateway_id: str
    start_s: int
    end_s: int


class Scenario(BaseModel):
    """Сценарий группировки формата `cosmo-A-1.0`."""

    # Версия схемы - обычная строка, а не литерал: чужое значение должно получить код
    # UNSUPPORTED_SCHEMA_VERSION от ядра, а не общую ошибку типа от pydantic.
    schema_version: str = Field(description=f"Ожидается {SCENARIO_SCHEMA_VERSION}")
    meta: ScenarioMeta
    environment: Environment
    design: Design
    ground_sites: list[GroundSite]
    # Разделы обязательны, хотя пустой список допустим: ядро и эталонный `geometry.py`
    # обращаются к ним без проверки наличия, и молчаливо принятый файл без `failures`
    # дал бы на одном и том же входе разный ответ у API и у ядра.
    failures: list[SatelliteFailure]
    gateway_outages: list[GatewayOutage]


class ScenarioValidationResult(BaseModel):
    """Сводка принятого сценария (`POST /api/scenarios/validate`).

    Ошибки входа возвращаются ответом 400 со списком `errors[]` (`05_API.md` §3), поэтому
    успешный ответ их не содержит и вместо этого показывает состав группировки: экран
    загрузки обязан показать, что именно сервис будет считать (`01_SPEC.md` §4.1).
    """

    schema_version: str
    plane_count: int
    satellite_count: int = Field(description="Аппаратов в сценарии, независимо от очереди")
    active_satellite_count: int = Field(
        description="Аппаратов с `launch_batch <= launch_stage`",
    )
    client_count: int
    gateway_count: int
    total_ticks: int = Field(description="`horizon_s / step_s`: отсчётов в расчёте")
    config_hash: str = Field(
        description=(
            "sha256 канонического сценария: совпадение хэшей означает, что два файла "
            "задают один и тот же расчёт (ADR-011)"
        ),
    )
