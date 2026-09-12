"""Сценарий `cosmo-A-1.0`: загрузка, валидация с JSON path, канонизация, config_hash.

Модуль отвечает за вход расчёта (`01_SPEC.md` §3) и за первые два шага pipeline из
`04_CORE.md` §2. Валидация собирает **все** ошибки списком: кейс требует показать
инженеру, что именно исправить в файле, а не первую попавшуюся проблему.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Final

import numpy as np
from numpy.typing import NDArray

SCHEMA_VERSION: Final[str] = "cosmo-A-1.0"

# Границы из `01_SPEC.md` §3.1 (они же в `geometry.validate` официального модуля).
ALTITUDE_MIN_KM: Final[float] = 200.0
ALTITUDE_MAX_KM: Final[float] = 1200.0
INCLINATION_MAX_DEG: Final[float] = 180.0
HORIZON_MAX_S: Final[int] = 172_800
ELEVATION_MAX_DEG: Final[float] = 90.0
ISL_RANGE_MAX_KM: Final[float] = 10_000.0
FULL_TURN_DEG: Final[float] = 360.0
LAUNCH_STAGES: Final[tuple[int, ...]] = (1, 2, 3)


class ErrorCode(StrEnum):
    """Коды ошибок из `03_GLOSSARY.md` §3.6.

    Перечисление общее для всего продукта: API отдаёт клиенту эти же строки. Валидация
    сценария использует семь первых кодов, остальные принадлежат слою выполнения Run и
    хранилищам и объявлены здесь, чтобы написание кода жило в одном месте.
    """

    UNSUPPORTED_SCHEMA_VERSION = "UNSUPPORTED_SCHEMA_VERSION"
    INVALID_SCENARIO_FIELD = "INVALID_SCENARIO_FIELD"
    DUPLICATE_NODE_ID = "DUPLICATE_NODE_ID"
    UNRESOLVED_REFERENCE = "UNRESOLVED_REFERENCE"
    INVALID_TIME_GRID = "INVALID_TIME_GRID"
    INVALID_OUTAGE_INTERVAL = "INVALID_OUTAGE_INTERVAL"
    MISSING_SITE_ROLE = "MISSING_SITE_ROLE"
    RUN_NOT_READY = "RUN_NOT_READY"
    RUN_FAILED = "RUN_FAILED"
    EXPERIMENT_BUDGET_EXCEEDED = "EXPERIMENT_BUDGET_EXCEEDED"
    INTERNAL_INCONSISTENCY = "INTERNAL_INCONSISTENCY"
    STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE"


class SiteRole(StrEnum):
    """Роль наземного пункта, `03_GLOSSARY.md` §3.5."""

    CLIENT = "client"
    GATEWAY = "gateway"


@dataclass(frozen=True, slots=True)
class ScenarioIssue:
    """Одна ошибка валидации: код, путь до поля в точечной нотации и пояснение."""

    code: ErrorCode
    path: str
    message: str
    details: dict[str, object] = field(default_factory=dict)


class ScenarioError(Exception):
    """Сценарий не прошёл валидацию. В `errors` лежат все найденные ошибки."""

    def __init__(self, errors: Sequence[ScenarioIssue]) -> None:
        self.errors: list[ScenarioIssue] = list(errors)
        summary = "; ".join(f"{issue.code} @ {issue.path or '<root>'}" for issue in self.errors)
        super().__init__(f"ошибок в сценарии: {len(self.errors)} ({summary})")


@dataclass(frozen=True, slots=True)
class Environment:
    """Параметры расчёта, `01_SPEC.md` §3."""

    altitude_km: float
    inclination_deg: float
    earth_angle0_deg: float
    horizon_s: int
    step_s: int
    min_elevation_deg: float
    isl_range_km: float
    target_availability: float


@dataclass(frozen=True, slots=True)
class Plane:
    """Орбитальная плоскость: ориентация `raan_deg` и общее фазирование `phase_deg`."""

    id: str
    raan_deg: float
    phase_deg: float


@dataclass(frozen=True, slots=True)
class Satellite:
    """Аппарат: слот в своей плоскости и очередь запуска."""

    id: str
    plane_id: str
    slot_deg: float
    launch_batch: int


@dataclass(frozen=True, slots=True)
class GroundSite:
    """Наземный пункт: клиент или шлюз."""

    id: str
    name: str
    role: SiteRole
    lat_deg: float
    lon_deg: float
    # Optional local horizon mask.  ``None`` deliberately means "use the
    # environment default" so old scenario files remain byte-for-byte
    # canonical-compatible.
    min_elevation_deg: float | None = None


@dataclass(frozen=True, slots=True)
class Unavailability:
    """Интервал недоступности `[start_s; end_s)` аппарата или шлюза.

    Отказы спутников и недоступность шлюзов различаются только именем ссылки в JSON,
    правила проверки и объединения у них одни и те же, поэтому тип общий.
    """

    node_id: str
    start_s: float
    end_s: float

    def covers(self, t_s: float) -> bool:
        """Начало интервала включительно, конец исключительно (`01_SPEC.md` §2.6)."""
        return self.start_s <= t_s < self.end_s


@dataclass(frozen=True, slots=True)
class Scenario:
    """Канонизированный сценарий с производными индексами.

    Хранит исходные данные в том виде, в котором они пойдут в расчёт и в
    `effective_scenario` экспорта, плюс индексы, которые иначе пришлось бы строить
    заново в каждом модуле ядра.
    """

    schema_version: str
    meta: dict[str, object]
    environment: Environment
    launch_stage: int
    planes: tuple[Plane, ...]
    satellites: tuple[Satellite, ...]
    ground_sites: tuple[GroundSite, ...]
    failures: tuple[Unavailability, ...]
    gateway_outages: tuple[Unavailability, ...]
    satellite_index: dict[str, int]
    site_index: dict[str, int]
    plane_of_satellite: tuple[int, ...]
    client_indices: tuple[int, ...]
    gateway_indices: tuple[int, ...]

    @property
    def ticks(self) -> int:
        """Число отсчётов сетки: правый конец горизонта в сетку не входит."""
        return self.environment.horizon_s // self.environment.step_s

    @property
    def times_s(self) -> NDArray[np.float64]:
        """Времена отсчётов `0, step_s, …, horizon_s − step_s` в секундах."""
        return np.arange(self.ticks, dtype=np.float64) * float(self.environment.step_s)

    @property
    def client_ids(self) -> tuple[str, ...]:
        return tuple(self.ground_sites[i].id for i in self.client_indices)

    @property
    def gateway_ids(self) -> tuple[str, ...]:
        return tuple(self.ground_sites[i].id for i in self.gateway_indices)


def normalize_angle_deg(value: float) -> float:
    """Приводит угол к [0; 360).

    Канонизация нужна, чтобы два сценария, отличающиеся только целым числом оборотов,
    давали один `config_hash` и один и тот же готовый Run (ADR-011).
    """
    normalized = math.fmod(value, FULL_TURN_DEG)
    if normalized < 0.0:
        normalized += FULL_TURN_DEG
    # fmod от очень малого отрицательного числа после сложения округляется ровно до 360.0.
    if normalized >= FULL_TURN_DEG:
        return 0.0
    return normalized


def merge_unavailability(items: Sequence[Unavailability]) -> tuple[Unavailability, ...]:
    """Объединяет пересекающиеся и смежные интервалы одного узла.

    Смежные тоже объединяются: `[0; 10)` и `[10; 20)` покрывают ровно то же время, что
    `[0; 20)`, и должны давать одинаковый `config_hash` (инвариант 13 `10_FIXTURES.md`).
    """
    merged: list[Unavailability] = []
    for item in sorted(items, key=lambda interval: (interval.node_id, interval.start_s)):
        previous = merged[-1] if merged else None
        overlaps = (
            previous is not None
            and previous.node_id == item.node_id
            and item.start_s <= previous.end_s
        )
        if previous is not None and overlaps:
            merged[-1] = Unavailability(
                node_id=previous.node_id,
                start_s=previous.start_s,
                end_s=max(previous.end_s, item.end_s),
            )
            continue
        merged.append(item)
    return tuple(merged)


_SITE_ROLES: Final[frozenset[str]] = frozenset(role.value for role in SiteRole)


class _Validator:
    """Накопитель ошибок и типизированные геттеры по JSON-документу."""

    def __init__(self) -> None:
        self.issues: list[ScenarioIssue] = []

    def add(self, code: ErrorCode, path: str, message: str, **details: object) -> None:
        self.issues.append(
            ScenarioIssue(code=code, path=path, message=message, details=dict(details))
        )

    def mapping(self, value: object, path: str) -> Mapping[str, object] | None:
        if not isinstance(value, dict):
            self.add(ErrorCode.INVALID_SCENARIO_FIELD, path, "ожидался объект")
            return None
        return value

    def sequence(self, value: object, path: str) -> list[object] | None:
        if not isinstance(value, list):
            self.add(ErrorCode.INVALID_SCENARIO_FIELD, path, "ожидался список")
            return None
        return value

    def required(
        self,
        container: Mapping[str, object],
        key: str,
        path: str,
        code: ErrorCode = ErrorCode.INVALID_SCENARIO_FIELD,
    ) -> object | None:
        if key not in container:
            self.add(code, path, "обязательное поле отсутствует")
            return None
        return container[key]

    def number(self, container: Mapping[str, object], key: str, path: str) -> float | None:
        value = self.required(container, key, path)
        if value is None:
            return None
        # `bool` — подкласс `int`, но числом в сценарии не является.
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
        ):
            self.add(ErrorCode.INVALID_SCENARIO_FIELD, path, "ожидалось конечное число")
            return None
        return float(value)

    def integer(
        self,
        container: Mapping[str, object],
        key: str,
        path: str,
        code: ErrorCode = ErrorCode.INVALID_SCENARIO_FIELD,
    ) -> int | None:
        value = self.required(container, key, path, code)
        if value is None:
            return None
        if not isinstance(value, int) or isinstance(value, bool):
            self.add(code, path, "ожидалось целое число")
            return None
        return value

    def text(self, container: Mapping[str, object], key: str, path: str) -> str | None:
        value = self.required(container, key, path)
        if value is None:
            return None
        if not isinstance(value, str) or not value:
            self.add(ErrorCode.INVALID_SCENARIO_FIELD, path, "ожидалась непустая строка")
            return None
        return value


def _parse_environment(validator: _Validator, root: Mapping[str, object]) -> Environment | None:
    section = validator.required(root, "environment", "environment")
    if section is None:
        return None
    env = validator.mapping(section, "environment")
    if env is None:
        return None

    altitude_km = validator.number(env, "altitude_km", "environment.altitude_km")
    if altitude_km is not None and not ALTITUDE_MIN_KM <= altitude_km <= ALTITUDE_MAX_KM:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD,
            "environment.altitude_km",
            f"высота вне [{ALTITUDE_MIN_KM:g}; {ALTITUDE_MAX_KM:g}] км",
            value=altitude_km,
        )

    inclination_deg = validator.number(env, "inclination_deg", "environment.inclination_deg")
    if inclination_deg is not None and not 0.0 < inclination_deg <= INCLINATION_MAX_DEG:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD,
            "environment.inclination_deg",
            "наклонение вне (0; 180] градусов",
            value=inclination_deg,
        )

    earth_angle0_deg = validator.number(env, "earth_angle0_deg", "environment.earth_angle0_deg")

    horizon_s = validator.integer(
        env, "horizon_s", "environment.horizon_s", ErrorCode.INVALID_TIME_GRID
    )
    if horizon_s is not None and not 0 < horizon_s <= HORIZON_MAX_S:
        validator.add(
            ErrorCode.INVALID_TIME_GRID,
            "environment.horizon_s",
            f"горизонт вне (0; {HORIZON_MAX_S}] секунд",
            value=horizon_s,
        )
        horizon_s = None

    step_s = validator.integer(env, "step_s", "environment.step_s", ErrorCode.INVALID_TIME_GRID)
    if step_s is not None and step_s <= 0:
        validator.add(
            ErrorCode.INVALID_TIME_GRID,
            "environment.step_s",
            "шаг должен быть положительным",
            value=step_s,
        )
        step_s = None

    if (
        horizon_s is not None
        and step_s is not None
        and (step_s > horizon_s or horizon_s % step_s != 0)
    ):
        validator.add(
            ErrorCode.INVALID_TIME_GRID,
            "environment.horizon_s",
            "горизонт должен быть кратен шагу и не меньше шага",
            horizon_s=horizon_s,
            step_s=step_s,
        )
        horizon_s = None

    min_elevation_deg = validator.number(env, "min_elevation_deg", "environment.min_elevation_deg")
    if min_elevation_deg is not None and not 0.0 <= min_elevation_deg < ELEVATION_MAX_DEG:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD,
            "environment.min_elevation_deg",
            "минимальный угол возвышения вне [0; 90) градусов",
            value=min_elevation_deg,
        )

    isl_range_km = validator.number(env, "isl_range_km", "environment.isl_range_km")
    if isl_range_km is not None and not 0.0 < isl_range_km <= ISL_RANGE_MAX_KM:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD,
            "environment.isl_range_km",
            f"дальность ISL вне (0; {ISL_RANGE_MAX_KM:g}] км",
            value=isl_range_km,
        )

    target_availability = validator.number(
        env, "target_availability", "environment.target_availability"
    )
    if target_availability is not None and not 0.0 <= target_availability <= 1.0:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD,
            "environment.target_availability",
            "целевая доступность вне [0; 1]",
            value=target_availability,
        )

    if (
        altitude_km is None
        or inclination_deg is None
        or earth_angle0_deg is None
        or horizon_s is None
        or step_s is None
        or min_elevation_deg is None
        or isl_range_km is None
        or target_availability is None
    ):
        return None
    return Environment(
        altitude_km=altitude_km,
        inclination_deg=inclination_deg,
        # Целое число оборотов Земли на старте расчёта ничего не меняет: угол канонизируется.
        earth_angle0_deg=normalize_angle_deg(earth_angle0_deg),
        horizon_s=horizon_s,
        step_s=step_s,
        min_elevation_deg=min_elevation_deg,
        isl_range_km=isl_range_km,
        target_availability=target_availability,
    )


def _parse_planes(
    validator: _Validator, design: Mapping[str, object]
) -> tuple[tuple[Plane, ...], frozenset[str]]:
    """Плоскости и множество объявленных идентификаторов.

    Идентификатор попадает во второе множество, даже если у плоскости неверные углы:
    иначе одна ошибка в `raan_deg` превратилась бы в десятки ложных
    `UNRESOLVED_REFERENCE` у аппаратов этой плоскости.
    """
    section = validator.required(design, "planes", "design.planes")
    if section is None:
        return (), frozenset()
    raw_planes = validator.sequence(section, "design.planes")
    if raw_planes is None:
        return (), frozenset()
    if not raw_planes:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD, "design.planes", "нужна хотя бы одна плоскость"
        )
        return (), frozenset()

    planes: list[Plane] = []
    declared: set[str] = set()
    for index, raw in enumerate(raw_planes):
        base = f"design.planes[{index}]"
        plane = validator.mapping(raw, base)
        if plane is None:
            continue
        plane_id = validator.text(plane, "id", f"{base}.id")
        if plane_id is not None and plane_id in declared:
            validator.add(
                ErrorCode.DUPLICATE_NODE_ID,
                f"{base}.id",
                "идентификатор плоскости повторяется",
                id=plane_id,
            )
            plane_id = None
        if plane_id is not None:
            declared.add(plane_id)
        angles: dict[str, float] = {}
        for key in ("raan_deg", "phase_deg"):
            angle = validator.number(plane, key, f"{base}.{key}")
            if angle is not None and not 0.0 <= angle < FULL_TURN_DEG:
                validator.add(
                    ErrorCode.INVALID_SCENARIO_FIELD,
                    f"{base}.{key}",
                    "угол вне [0; 360) градусов",
                    value=angle,
                )
                continue
            if angle is not None:
                angles[key] = angle
        if plane_id is None or len(angles) != 2:
            continue
        planes.append(
            Plane(id=plane_id, raan_deg=angles["raan_deg"], phase_deg=angles["phase_deg"])
        )
    return tuple(planes), frozenset(declared)


def _parse_satellites(
    validator: _Validator, design: Mapping[str, object], plane_ids: frozenset[str]
) -> tuple[tuple[Satellite, ...], frozenset[str]]:
    """Аппараты и множество объявленных идентификаторов (см. `_parse_planes`)."""
    section = validator.required(design, "satellites", "design.satellites")
    if section is None:
        return (), frozenset()
    raw_satellites = validator.sequence(section, "design.satellites")
    if raw_satellites is None:
        return (), frozenset()
    if not raw_satellites:
        validator.add(
            ErrorCode.INVALID_SCENARIO_FIELD, "design.satellites", "нужен хотя бы один аппарат"
        )
        return (), frozenset()

    satellites: list[Satellite] = []
    declared: set[str] = set()
    for index, raw in enumerate(raw_satellites):
        base = f"design.satellites[{index}]"
        satellite = validator.mapping(raw, base)
        if satellite is None:
            continue
        satellite_id = validator.text(satellite, "id", f"{base}.id")
        if satellite_id is not None and satellite_id in declared:
            validator.add(
                ErrorCode.DUPLICATE_NODE_ID,
                f"{base}.id",
                "идентификатор аппарата повторяется",
                id=satellite_id,
            )
            satellite_id = None
        if satellite_id is not None:
            declared.add(satellite_id)
        plane_id = validator.text(satellite, "plane_id", f"{base}.plane_id")
        if plane_id is not None and plane_id not in plane_ids:
            validator.add(
                ErrorCode.UNRESOLVED_REFERENCE,
                f"{base}.plane_id",
                "плоскость с таким идентификатором не объявлена",
                plane_id=plane_id,
            )
            plane_id = None
        slot_deg = validator.number(satellite, "slot_deg", f"{base}.slot_deg")
        launch_batch = validator.integer(satellite, "launch_batch", f"{base}.launch_batch")
        if launch_batch is not None and launch_batch not in LAUNCH_STAGES:
            validator.add(
                ErrorCode.INVALID_SCENARIO_FIELD,
                f"{base}.launch_batch",
                "очередь запуска должна быть 1, 2 или 3",
                value=launch_batch,
            )
            launch_batch = None
        if satellite_id is None or plane_id is None or slot_deg is None or launch_batch is None:
            continue
        satellites.append(
            Satellite(
                id=satellite_id,
                plane_id=plane_id,
                # Слот не ограничен диапазоном в `geometry.validate`, поэтому канонизируется.
                slot_deg=normalize_angle_deg(slot_deg),
                launch_batch=launch_batch,
            )
        )
    return tuple(satellites), frozenset(declared)


def _parse_ground_sites(
    validator: _Validator, root: Mapping[str, object], satellite_ids: frozenset[str]
) -> tuple[tuple[GroundSite, ...], frozenset[str]]:
    """Наземные пункты и множество объявленных шлюзов (см. `_parse_planes`)."""
    section = validator.required(root, "ground_sites", "ground_sites")
    if section is None:
        return (), frozenset()
    raw_sites = validator.sequence(section, "ground_sites")
    if raw_sites is None:
        return (), frozenset()

    sites: list[GroundSite] = []
    declared: set[str] = set()
    declared_gateways: set[str] = set()
    declared_roles: set[SiteRole] = set()
    for index, raw in enumerate(raw_sites):
        base = f"ground_sites[{index}]"
        site = validator.mapping(raw, base)
        if site is None:
            continue
        site_id = validator.text(site, "id", f"{base}.id")
        if site_id is not None and (site_id in declared or site_id in satellite_ids):
            validator.add(
                ErrorCode.DUPLICATE_NODE_ID,
                f"{base}.id",
                "идентификаторы наземных пунктов и аппаратов не должны пересекаться",
                id=site_id,
            )
            site_id = None
        if site_id is not None:
            declared.add(site_id)
        raw_role = validator.text(site, "role", f"{base}.role")
        role: SiteRole | None = None
        if raw_role is not None and raw_role not in _SITE_ROLES:
            validator.add(
                ErrorCode.INVALID_SCENARIO_FIELD,
                f"{base}.role",
                "роль должна быть client или gateway",
                value=raw_role,
            )
        elif raw_role is not None:
            role = SiteRole(raw_role)
        if role is not None:
            declared_roles.add(role)
        if role is SiteRole.GATEWAY and site_id is not None:
            declared_gateways.add(site_id)
        lat_deg = validator.number(site, "lat_deg", f"{base}.lat_deg")
        if lat_deg is not None and not -90.0 <= lat_deg <= 90.0:
            validator.add(
                ErrorCode.INVALID_SCENARIO_FIELD,
                f"{base}.lat_deg",
                "широта вне [−90; 90]",
                value=lat_deg,
            )
            lat_deg = None
        lon_deg = validator.number(site, "lon_deg", f"{base}.lon_deg")
        if lon_deg is not None and not -180.0 <= lon_deg <= 180.0:
            validator.add(
                ErrorCode.INVALID_SCENARIO_FIELD,
                f"{base}.lon_deg",
                "долгота вне [−180; 180]",
                value=lon_deg,
            )
            lon_deg = None
        min_elevation_deg: float | None = None
        if "min_elevation_deg" in site:
            min_elevation_deg = validator.number(
                site, "min_elevation_deg", f"{base}.min_elevation_deg"
            )
            if min_elevation_deg is not None and not 0.0 <= min_elevation_deg < ELEVATION_MAX_DEG:
                validator.add(
                    ErrorCode.INVALID_SCENARIO_FIELD,
                    f"{base}.min_elevation_deg",
                    "минимальный угол возвышения вне [0; 90) градусов",
                    value=min_elevation_deg,
                )
                min_elevation_deg = None
        if site_id is None or role is None or lat_deg is None or lon_deg is None:
            continue
        # Название нужно только для интерфейса и на расчёт не влияет, поэтому его
        # отсутствие не ошибка: подставляем идентификатор.
        raw_name = site.get("name")
        name = raw_name if isinstance(raw_name, str) and raw_name else site_id
        sites.append(
            GroundSite(
                id=site_id,
                name=name,
                role=role,
                lat_deg=lat_deg,
                lon_deg=lon_deg,
                min_elevation_deg=min_elevation_deg,
            )
        )

    # Роли считаются по объявленным пунктам, а не только по прошедшим проверку: иначе
    # ошибка в координатах единственного шлюза породила бы вторую, ложную ошибку.
    if SiteRole.CLIENT not in declared_roles or SiteRole.GATEWAY not in declared_roles:
        validator.add(
            ErrorCode.MISSING_SITE_ROLE,
            "ground_sites",
            "нужен хотя бы один клиент и хотя бы один шлюз",
            roles=sorted(str(role) for role in declared_roles),
        )
    return tuple(sites), frozenset(declared_gateways)


def _parse_unavailability(
    validator: _Validator,
    root: Mapping[str, object],
    section_name: str,
    reference_key: str,
    known_ids: frozenset[str],
    horizon_s: int | None,
) -> tuple[Unavailability, ...]:
    section = validator.required(root, section_name, section_name)
    if section is None:
        return ()
    raw_items = validator.sequence(section, section_name)
    if raw_items is None:
        return ()

    intervals: list[Unavailability] = []
    for index, raw in enumerate(raw_items):
        base = f"{section_name}[{index}]"
        item = validator.mapping(raw, base)
        if item is None:
            continue
        node_id = validator.text(item, reference_key, f"{base}.{reference_key}")
        if node_id is not None and node_id not in known_ids:
            validator.add(
                ErrorCode.UNRESOLVED_REFERENCE,
                f"{base}.{reference_key}",
                "объект с таким идентификатором не объявлен",
                **{reference_key: node_id},
            )
            node_id = None
        start_s = validator.number(item, "start_s", f"{base}.start_s")
        end_s = validator.number(item, "end_s", f"{base}.end_s")
        if start_s is None or end_s is None:
            continue
        # Путь указывает на объект целиком: проблема в паре границ, а не в одном поле.
        if start_s < 0.0 or start_s >= end_s:
            validator.add(
                ErrorCode.INVALID_OUTAGE_INTERVAL,
                base,
                "интервал должен иметь положительную длительность и начинаться не раньше нуля",
                start_s=start_s,
                end_s=end_s,
            )
            continue
        if horizon_s is not None and end_s > float(horizon_s):
            validator.add(
                ErrorCode.INVALID_OUTAGE_INTERVAL,
                base,
                "интервал выходит за горизонт расчёта",
                end_s=end_s,
                horizon_s=horizon_s,
            )
            continue
        if node_id is None:
            continue
        intervals.append(Unavailability(node_id=node_id, start_s=start_s, end_s=end_s))
    return merge_unavailability(intervals)


def _build(
    schema_version: str,
    meta: dict[str, object],
    environment: Environment,
    launch_stage: int,
    planes: tuple[Plane, ...],
    satellites: tuple[Satellite, ...],
    ground_sites: tuple[GroundSite, ...],
    failures: tuple[Unavailability, ...],
    gateway_outages: tuple[Unavailability, ...],
) -> Scenario:
    """Сортирует списки по `id` и строит производные индексы."""
    sorted_planes = tuple(sorted(planes, key=lambda plane: plane.id))
    sorted_satellites = tuple(sorted(satellites, key=lambda satellite: satellite.id))
    sorted_sites = tuple(sorted(ground_sites, key=lambda site: site.id))
    plane_index = {plane.id: index for index, plane in enumerate(sorted_planes)}
    return Scenario(
        schema_version=schema_version,
        meta=meta,
        environment=environment,
        launch_stage=launch_stage,
        planes=sorted_planes,
        satellites=sorted_satellites,
        ground_sites=sorted_sites,
        failures=failures,
        gateway_outages=gateway_outages,
        satellite_index={satellite.id: index for index, satellite in enumerate(sorted_satellites)},
        site_index={site.id: index for index, site in enumerate(sorted_sites)},
        plane_of_satellite=tuple(
            plane_index[satellite.plane_id] for satellite in sorted_satellites
        ),
        client_indices=tuple(
            index for index, site in enumerate(sorted_sites) if site.role is SiteRole.CLIENT
        ),
        gateway_indices=tuple(
            index for index, site in enumerate(sorted_sites) if site.role is SiteRole.GATEWAY
        ),
    )


def _parse(data: object) -> tuple[list[ScenarioIssue], Scenario | None]:
    validator = _Validator()
    root = validator.mapping(data, "")
    if root is None:
        return validator.issues, None

    schema_version = root.get("schema_version")
    if schema_version != SCHEMA_VERSION:
        validator.add(
            ErrorCode.UNSUPPORTED_SCHEMA_VERSION,
            "schema_version",
            f"поддерживается только {SCHEMA_VERSION}",
            value=schema_version,
        )
    raw_meta = root.get("meta")
    # `meta` — только подпись варианта в интерфейсе, на расчёт не влияет.
    meta: dict[str, object] = dict(raw_meta) if isinstance(raw_meta, dict) else {}

    environment = _parse_environment(validator, root)

    planes: tuple[Plane, ...] = ()
    satellites: tuple[Satellite, ...] = ()
    satellite_ids: frozenset[str] = frozenset()
    launch_stage: int | None = None
    raw_design = validator.required(root, "design", "design")
    design = validator.mapping(raw_design, "design") if raw_design is not None else None
    if design is not None:
        launch_stage = validator.integer(design, "launch_stage", "design.launch_stage")
        if launch_stage is not None and launch_stage not in LAUNCH_STAGES:
            validator.add(
                ErrorCode.INVALID_SCENARIO_FIELD,
                "design.launch_stage",
                "этап развёртывания должен быть 1, 2 или 3",
                value=launch_stage,
            )
            launch_stage = None
        planes, plane_ids = _parse_planes(validator, design)
        satellites, satellite_ids = _parse_satellites(validator, design, plane_ids)

    ground_sites, gateway_ids = _parse_ground_sites(validator, root, satellite_ids)
    horizon_s = environment.horizon_s if environment is not None else None

    failures = _parse_unavailability(
        validator, root, "failures", "satellite_id", satellite_ids, horizon_s
    )
    gateway_outages = _parse_unavailability(
        validator, root, "gateway_outages", "gateway_id", gateway_ids, horizon_s
    )

    if validator.issues or environment is None or launch_stage is None:
        return validator.issues, None
    return validator.issues, _build(
        schema_version=SCHEMA_VERSION,
        meta=meta,
        environment=environment,
        launch_stage=launch_stage,
        planes=planes,
        satellites=satellites,
        ground_sites=ground_sites,
        failures=failures,
        gateway_outages=gateway_outages,
    )


def validate(data: object) -> list[ScenarioIssue]:
    """Возвращает все ошибки сценария; пустой список означает, что сценарий корректен."""
    return _parse(data)[0]


def parse(data: object) -> Scenario:
    """Строит канонизированный `Scenario` из разобранного JSON.

    API получает словарь из тела запроса и не обязан класть его во временный файл,
    поэтому разбор и чтение файла разделены.
    """
    issues, scenario = _parse(data)
    if scenario is None:
        raise ScenarioError(issues)
    return scenario


def load(path: str | Path) -> Scenario:
    """Читает файл сценария и разбирает его."""
    text = Path(path).read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise ScenarioError(
            [
                ScenarioIssue(
                    code=ErrorCode.INVALID_SCENARIO_FIELD,
                    path="",
                    message=f"файл не является корректным JSON: {error.msg}",
                    details={"line": error.lineno, "column": error.colno},
                )
            ]
        ) from error
    return parse(data)


def to_dict(scenario: Scenario) -> dict[str, object]:
    """Сценарий обратно в структуру `cosmo-A-1.0` — она же `effective_scenario` экспорта."""
    return {
        "schema_version": scenario.schema_version,
        "meta": dict(scenario.meta),
        "environment": {
            "altitude_km": scenario.environment.altitude_km,
            "inclination_deg": scenario.environment.inclination_deg,
            "earth_angle0_deg": scenario.environment.earth_angle0_deg,
            "horizon_s": scenario.environment.horizon_s,
            "step_s": scenario.environment.step_s,
            "min_elevation_deg": scenario.environment.min_elevation_deg,
            "isl_range_km": scenario.environment.isl_range_km,
            "target_availability": scenario.environment.target_availability,
        },
        "design": {
            "launch_stage": scenario.launch_stage,
            "planes": [
                {"id": plane.id, "raan_deg": plane.raan_deg, "phase_deg": plane.phase_deg}
                for plane in scenario.planes
            ],
            "satellites": [
                {
                    "id": satellite.id,
                    "plane_id": satellite.plane_id,
                    "slot_deg": satellite.slot_deg,
                    "launch_batch": satellite.launch_batch,
                }
                for satellite in scenario.satellites
            ],
        },
        "ground_sites": [
            {
                "id": site.id,
                "name": site.name,
                "role": str(site.role),
                "lat_deg": site.lat_deg,
                "lon_deg": site.lon_deg,
                **(
                    {"min_elevation_deg": site.min_elevation_deg}
                    if site.min_elevation_deg is not None
                    else {}
                ),
            }
            for site in scenario.ground_sites
        ],
        "failures": [
            {"satellite_id": item.node_id, "start_s": item.start_s, "end_s": item.end_s}
            for item in scenario.failures
        ],
        "gateway_outages": [
            {"gateway_id": item.node_id, "start_s": item.start_s, "end_s": item.end_s}
            for item in scenario.gateway_outages
        ],
    }


def canonical_json(scenario: Scenario) -> str:
    """Детерминированное представление сценария: ключи отсортированы, пробелов нет."""
    return json.dumps(
        to_dict(scenario),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def config_hash(scenario: Scenario, routing_policy: str) -> str:
    """sha256 канонического сценария и политики маршрутизации (ADR-011).

    Политика входит в ключ, потому что при одном и том же сценарии разные политики дают
    разные маршруты и разные метрики `route_switches` и `mean_hops`.
    """
    payload = f"{canonical_json(scenario)}\n{routing_policy}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
