"""Сравнение двух расчётов одной задачи: что стало с перерывами и маршрутами.

Оба расчёта сделаны на одной сетке отсчётов, поэтому сравнивать их можно поотсчётно, а не
«в среднем»: перерыв — это максимальная непрерывная последовательность отсчётов без пути
(`04_CORE.md` §5), и два таких набора либо совпадают отсчёт в отсчёт, либо расходятся в
конкретных местах. Именно эти места и нужны инженеру, который смотрит на последствия
отказа: какой перерыв появился, какой исчез, какой сдвинул границы, где маршрут уцелел, а
где был перестроен.

Здесь только чистые функции на данных ядра: маршруты `RouteTable.paths` и перерывы
`metrics.OutageInterval`. Ни базы, ни HTTP, ни пересчёта — сравнение работает на уже
посчитанных результатах и потому стоит доли миллисекунды.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from orbita_core.diagnosis import OutageCause
from orbita_core.metrics import OutageInterval

# Маршрут клиента на одном отсчёте: узлы пути либо `None`, если пути нет. Тот же вид,
# в котором маршруты лежат в `RouteTable.paths`.
Path = Sequence[str] | None


class OutageChangeKind(StrEnum):
    """Что случилось с перерывом между базовым расчётом и сравниваемым.

    Отдельного вида «перерыв не изменился» нет намеренно: список изменений показывается
    целиком, и совпавшие перерывы в нём были бы шумом.
    """

    ADDED = "added"
    REMOVED = "removed"
    CHANGED = "changed"


@dataclass(frozen=True, slots=True)
class OutageChange:
    """Одно изменение перерыва с обеими границами и причиной.

    У появившегося перерыва нет базовой стороны, у исчезнувшего — сравниваемой, поэтому
    границы необязательны. Причина и отказавшие аппараты берутся у той стороны, чей
    перерыв описывается: у появившегося и изменившегося — «после», у исчезнувшего своей
    «после» просто нет, и объяснять приходится то, что пропало.
    """

    kind: OutageChangeKind
    base_start_s: int | None
    base_end_s: int | None
    other_start_s: int | None
    other_end_s: int | None
    primary_cause: OutageCause
    causes: tuple[OutageCause, ...]
    failed_satellites: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RouteComparison:
    """Судьба маршрутов клиента: сколько отсчётов уцелело и где началось расхождение."""

    route_kept_ticks: int
    route_rebuilt_ticks: int
    first_divergence_t_s: int | None
    first_new_outage_t_s: int | None


@dataclass(frozen=True, slots=True)
class ClientComparison:
    """Полная картина по одному клиенту: перерывы, маршруты и признак затронутости."""

    client_id: str
    outage_diff: tuple[OutageChange, ...]
    affected: bool
    route_kept_ticks: int
    route_rebuilt_ticks: int
    first_divergence_t_s: int | None
    first_new_outage_t_s: int | None


def _tick_span(interval: OutageInterval, step_s: int) -> tuple[int, int]:
    """Границы перерыва в отсчётах. Время не с сетки — ошибка входа, а не повод округлить."""
    if interval.start_s % step_s != 0 or interval.end_s % step_s != 0:
        raise ValueError(
            f"перерыв клиента {interval.client_id} [{interval.start_s}; {interval.end_s}) "
            f"не лежит на сетке с шагом {step_s} с",
        )
    return interval.start_s // step_s, interval.end_s // step_s


def _require_single_client(
    base: Sequence[OutageInterval], other: Sequence[OutageInterval]
) -> None:
    """Перерывы обеих сторон принадлежат одному клиенту.

    Перерывы разных клиентов на одной сетке свободно пересекаются, и сравнение вперемешку
    дало бы правдоподобный, но бессмысленный результат вместо явной ошибки.
    """
    clients = {interval.client_id for interval in (*base, *other)}
    if len(clients) > 1:
        raise ValueError(f"перерывы разных клиентов в одном сравнении: {sorted(clients)}")


def _added(interval: OutageInterval) -> OutageChange:
    return OutageChange(
        kind=OutageChangeKind.ADDED,
        base_start_s=None,
        base_end_s=None,
        other_start_s=interval.start_s,
        other_end_s=interval.end_s,
        primary_cause=interval.primary_cause,
        causes=interval.causes,
        failed_satellites=interval.failed_satellites,
    )


def _removed(interval: OutageInterval) -> OutageChange:
    return OutageChange(
        kind=OutageChangeKind.REMOVED,
        base_start_s=interval.start_s,
        base_end_s=interval.end_s,
        other_start_s=None,
        other_end_s=None,
        primary_cause=interval.primary_cause,
        causes=interval.causes,
        failed_satellites=interval.failed_satellites,
    )


def _changed(base: OutageInterval, other: OutageInterval) -> OutageChange:
    return OutageChange(
        kind=OutageChangeKind.CHANGED,
        base_start_s=base.start_s,
        base_end_s=base.end_s,
        other_start_s=other.start_s,
        other_end_s=other.end_s,
        primary_cause=other.primary_cause,
        causes=other.causes,
        failed_satellites=other.failed_satellites,
    )


def _order(change: OutageChange) -> tuple[int, str]:
    """Порядок вывода: по времени, затем по виду изменения.

    Время берётся по самой ранней из известных границ: у появившегося перерыва базовой
    границы нет, у исчезнувшего нет сравниваемой.
    """
    starts = [value for value in (change.base_start_s, change.other_start_s) if value is not None]
    return min(starts), str(change.kind)


def outage_diff(
    base: Sequence[OutageInterval],
    other: Sequence[OutageInterval],
    step_s: int,
) -> list[OutageChange]:
    """Что стало с перерывами одного клиента после изменения конфигурации.

    Перерывы каждой стороны — максимальные последовательности отсчётов без пути, поэтому
    два перерыва одной стороны никогда не соприкасаются, и связь между сторонами
    однозначно задаётся пересечением на сетке. Перерыв без пересечения на другой стороне
    появился (`added`) или исчез (`removed`); пересекающиеся с разными границами
    считаются изменившимися (`changed`), с совпадающими — не изменившимися и в результат
    не попадают.

    Слияние и разделение перерывов описываются теми же парами: два базовых перерыва,
    ставших одним, дают два `changed` с одной и той же границей «после». Свернуть их в
    одну запись значило бы потерять факт, что изменились оба.
    """
    _require_single_client(base, other)
    base_spans = [_tick_span(interval, step_s) for interval in base]
    other_spans = [_tick_span(interval, step_s) for interval in other]

    changes: list[OutageChange] = []
    matched: set[int] = set()
    for other_index, (other_start, other_end) in enumerate(other_spans):
        overlapping = [
            index
            for index, (base_start, base_end) in enumerate(base_spans)
            if base_start < other_end and other_start < base_end
        ]
        if not overlapping:
            changes.append(_added(other[other_index]))
            continue
        matched.update(overlapping)
        changes.extend(
            _changed(base[index], other[other_index])
            for index in overlapping
            if base_spans[index] != other_spans[other_index]
        )
    changes.extend(
        _removed(interval)
        for index, interval in enumerate(base)
        if index not in matched
    )
    changes.sort(key=_order)
    return changes


def compare_routes(base: Sequence[Path], other: Sequence[Path], step_s: int) -> RouteComparison:
    """Поотсчётное сравнение маршрутов одного клиента.

    Маршрут считается сохранившимся только при полном совпадении узел в узел: путь той же
    длины через другие аппараты — это перестроение, и для разбора отказа разница
    существенна.
    """
    if len(base) != len(other):
        raise ValueError(
            f"маршруты посчитаны на разном числе отсчётов: {len(base)} и {len(other)}",
        )
    kept = 0
    rebuilt = 0
    first_divergence: int | None = None
    first_new_outage: int | None = None
    for tick, (before, after) in enumerate(zip(base, other, strict=True)):
        if before is None and after is None:
            continue
        if before is not None and after is not None:
            if list(before) == list(after):
                kept += 1
                continue
            rebuilt += 1
        elif after is None and first_new_outage is None:
            # Путь был и пропал: с этого отсчёта клиент потерял связь, которая у него была.
            first_new_outage = tick * step_s
        if first_divergence is None:
            first_divergence = tick * step_s
    return RouteComparison(
        route_kept_ticks=kept,
        route_rebuilt_ticks=rebuilt,
        first_divergence_t_s=first_divergence,
        first_new_outage_t_s=first_new_outage,
    )


def _reachable_ticks(paths: Sequence[Path]) -> int:
    return sum(1 for path in paths if path is not None)


def compare_client(
    client_id: str,
    *,
    base_paths: Sequence[Path],
    other_paths: Sequence[Path],
    base_outages: Sequence[OutageInterval],
    other_outages: Sequence[OutageInterval],
    step_s: int,
) -> ClientComparison:
    """Сравнение одного клиента: перерывы, маршруты и вывод «затронут или нет».

    Перерывы обеих сторон — перерывы этого клиента; маршруты — его же, по отсчётам.
    Клиент считается затронутым, если у него появился или изменился хотя бы один перерыв
    либо упала доступность. Перестроенный маршрут при неизменной доступности затронутостью
    не считается: связь не пострадала, а изменение маршрута видно по `route_rebuilt_ticks`.
    """
    changes = outage_diff(base_outages, other_outages, step_s)
    routes = compare_routes(base_paths, other_paths, step_s)
    reshaped = {OutageChangeKind.ADDED, OutageChangeKind.CHANGED}
    affected = _reachable_ticks(other_paths) < _reachable_ticks(base_paths) or any(
        change.kind in reshaped for change in changes
    )
    return ClientComparison(
        client_id=client_id,
        outage_diff=tuple(changes),
        affected=affected,
        route_kept_ticks=routes.route_kept_ticks,
        route_rebuilt_ticks=routes.route_rebuilt_ticks,
        first_divergence_t_s=routes.first_divergence_t_s,
        first_new_outage_t_s=routes.first_new_outage_t_s,
    )
