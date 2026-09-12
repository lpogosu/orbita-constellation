"""Общий интерфейс хранилищ артефактов и графа.

Внешние хранилища (MinIO, Memgraph) и их локальные замены реализуют одни и те же
протоколы, поэтому degraded mode (`06_STORAGE.md` §7) меняет только объект, который
получит сервис, а не его код.

Здесь же лежат величины, общие для всех реализаций: имена ключей `06_STORAGE.md` §5,
сроки хранения §6 и разбор битовой матрицы трассы на интервалы контактов — он нужен
любому графовому хранилищу и не зависит от Cypher.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import Any, Final, Protocol, runtime_checkable
from uuid import UUID

import numpy as np
from numpy.typing import NDArray
from orbita_core.contacts import ContactPlan


class ArtifactKind(StrEnum):
    """Вид объекта, принадлежащего запуску (`06_STORAGE.md` §5)."""

    TRACE = "trace"
    EXPORT = "export"
    EVIDENCE_PACK = "evidence_pack"


# Имя файла и тип содержимого каждого вида. Тип нужен не для красоты: браузер, открывший
# ссылку на export.json из MinIO, должен получить JSON, а не предложение скачать файл.
ARTIFACT_FILES: Final[dict[ArtifactKind, tuple[str, str]]] = {
    ArtifactKind.TRACE: ("trace.bin", "application/octet-stream"),
    ArtifactKind.EXPORT: ("export.json", "application/json"),
    ArtifactKind.EVIDENCE_PACK: ("evidence.zip", "application/zip"),
}


def artifact_key(run_id: UUID, kind: ArtifactKind) -> str:
    """Ключ объекта запуска: `runs/{run_id}/trace.bin` и соседние (`06_STORAGE.md` §5)."""
    return f"runs/{run_id}/{ARTIFACT_FILES[kind][0]}"


def content_type(kind: ArtifactKind) -> str:
    return ARTIFACT_FILES[kind][1]


class Retention(StrEnum):
    """Срок жизни объекта из таблицы `06_STORAGE.md` §6.

    Значение попадает в тег объекта MinIO, а lifecycle-правила бакета удаляют объекты по
    этому тегу: правило по префиксу здесь не годится, потому что трасса и экспорт одного
    запуска лежат под общим префиксом `runs/{run_id}/`, а живут разное время.
    """

    INTERACTIVE = "interactive"
    SWEEP_POINT = "sweep-point"
    PROJECT = "project"


# `None` означает «до удаления проекта»: такие объекты не удаляются по времени.
RETENTION_PERIOD: Final[dict[Retention, timedelta | None]] = {
    Retention.INTERACTIVE: timedelta(hours=24),
    Retention.SWEEP_POINT: timedelta(days=7),
    Retention.PROJECT: None,
}


class NodeKind(StrEnum):
    """Роль узла графа контактов (`06_STORAGE.md` §4)."""

    SATELLITE = "satellite"
    CLIENT = "client"
    GATEWAY = "gateway"


class ArtifactNotFoundError(LookupError):
    """Объекта с таким ключом в хранилище нет.

    Отдельный тип, а не исключение драйвера: вызывающий код одинаково обрабатывает
    отсутствие трассы и в MinIO, и в локальном каталоге — её нужно пересчитать.
    """

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"артефакт {key} не найден")


@dataclass(frozen=True, slots=True)
class ContactInterval:
    """Непрерывная серия отсчётов, на которых линия связи существует.

    Границы `[start_tick; end_tick)`: конец исключительно, как и у интервалов
    недоступности в сценарии.
    """

    source: str
    target: str
    start_tick: int
    end_tick: int
    min_distance_km: float
    max_distance_km: float


@dataclass(frozen=True, slots=True)
class LineageEdge:
    """Ребро происхождения вариантов: вариант и его родитель с дельтами метрик."""

    variant_id: UUID
    parent_variant_id: UUID | None
    title: str
    config_hash: str
    diff: tuple[Mapping[str, Any], ...]
    deltas: Mapping[str, float]


def node_kinds(plan: ContactPlan) -> dict[str, NodeKind]:
    """Роль каждого узла плана: аппарат, клиентский пункт или шлюз."""
    gateways = frozenset(plan.gateway_ids)
    kinds: dict[str, NodeKind] = {}
    for index, node in enumerate(plan.nodes):
        if index < plan.satellite_count:
            kinds[node] = NodeKind.SATELLITE
        else:
            kinds[node] = NodeKind.GATEWAY if node in gateways else NodeKind.CLIENT
    return kinds


def ones_runs(column: NDArray[np.bool_]) -> NDArray[np.int64]:
    """Границы непрерывных серий единиц столбца: массив пар `(start, end)`.

    Серии ищутся по сменам значения на дополненном нулями столбце, а не циклом по
    отсчётам: у трассы суток десятки тысяч столбцов, и цикл на Python стоил бы секунд.
    """
    padded = np.concatenate((np.zeros(1, dtype=np.bool_), column, np.zeros(1, dtype=np.bool_)))
    changes = np.flatnonzero(padded[1:] != padded[:-1]).astype(np.int64)
    return changes.reshape(-1, 2)


def contact_intervals(plan: ContactPlan) -> tuple[ContactInterval, ...]:
    """Переводит битовую матрицу плана в интервалы контактов.

    Одно ребро на каждый отсчёт превратило бы граф суток в сотни тысяч рёбер, поэтому в
    Memgraph уходит по ребру на непрерывную серию (`06_STORAGE.md` §4).
    """
    intervals: list[ContactInterval] = []
    for edge_index in range(plan.edge_count):
        source = plan.nodes[int(plan.edges[edge_index, 0])]
        target = plan.nodes[int(plan.edges[edge_index, 1])]
        distances = plan.dist[:, edge_index]
        for start, end in ones_runs(plan.bits[:, edge_index]):
            window = distances[start:end]
            intervals.append(
                ContactInterval(
                    source=source,
                    target=target,
                    start_tick=int(start),
                    end_tick=int(end),
                    min_distance_km=float(window.min()),
                    max_distance_km=float(window.max()),
                ),
            )
    return tuple(intervals)


@runtime_checkable
class ArtifactStore(Protocol):
    """Хранилище бинарных объектов запуска: трасса, экспорт, Evidence Pack."""

    async def put(self, key: str, data: bytes, content_type: str, retention: Retention) -> str:
        """Записывает объект и возвращает его URI для колонки `artifacts.uri`."""
        ...

    async def get(self, key: str) -> bytes:
        """Читает объект; `ArtifactNotFoundError`, если его нет."""
        ...

    async def exists(self, key: str) -> bool: ...

    async def delete(self, key: str) -> None:
        """Удаляет объект; отсутствие объекта ошибкой не считается."""
        ...

    async def ping(self) -> bool:
        """Хранилище отвечает и готово принимать объекты."""
        ...

    async def aclose(self) -> None: ...


@runtime_checkable
class GraphStore(Protocol):
    """Хранилище временного графа контактов и происхождения вариантов (ADR-009)."""

    @property
    def persistent(self) -> bool:
        """Хранит ли реализация записанное. У заглушки degraded mode — нет."""
        ...

    async def save_run_graph(
        self,
        run_id: UUID,
        engine_version: str,
        routing_policy: str,
        plan: ContactPlan,
        plane_ids: Mapping[str, str],
    ) -> None:
        """Сохраняет узлы запуска и контакты интервалами."""
        ...

    async def save_variant_lineage(
        self,
        variant_id: UUID,
        project_id: UUID,
        title: str,
        config_hash: str,
        parent_variant_id: UUID | None,
        diff: Sequence[Mapping[str, Any]],
        deltas: Mapping[str, float],
    ) -> None:
        """Сохраняет вариант и ребро `DERIVED_FROM` к родителю (ADR-011)."""
        ...

    async def contacts_of(self, run_id: UUID, node_id: str) -> tuple[ContactInterval, ...]:
        """Контакты узла за весь горизонт, по возрастанию начала интервала."""
        ...

    async def lineage(self, project_id: UUID) -> tuple[LineageEdge, ...]: ...

    async def delete_run(self, run_id: UUID) -> None: ...

    async def ping(self) -> bool: ...

    async def aclose(self) -> None: ...
