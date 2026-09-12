"""Enum и мелкие типы, общие для всех контрактов (`03_GLOSSARY.md` §3-4).

Значения enum совпадают с глоссарием посимвольно: они уходят в OpenAPI и становятся
литеральными типами фронтенда, поэтому «почти такое же» написание ломает клиент.
"""

from enum import StrEnum
from typing import Final, TypeAlias

from pydantic import BaseModel, ConfigDict, Field


class RoutingPolicy(StrEnum):
    """Стратегия поиска и обновления маршрута (`03_GLOSSARY.md` §3.2, ADR-003)."""

    BFS_SHORTEST = "bfs_shortest"
    PERSISTENT = "persistent"
    DIJKSTRA_DISTANCE = "dijkstra_distance"


class RunStatus(StrEnum):
    """Состояние запуска (`03_GLOSSARY.md` §3.3).

    Тот же набор значений описывает состояние задачи воркера и эксперимента: глоссарий
    определяет `RunStatus` и `JobStatus` одним списком, поэтому второго enum нет.
    """

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Из этих состояний запуск уже не выйдет: поток событий закрывается, отменять нечего,
# результат либо есть, либо его не будет (`03_GLOSSARY.md` §3.3).
TERMINAL_RUN_STATUSES: Final[frozenset[RunStatus]] = frozenset(
    {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED},
)


class RunStage(StrEnum):
    """Стадия выполнения запуска (`03_GLOSSARY.md` §3.4)."""

    VALIDATE = "validate"
    GEOMETRY = "geometry"
    CONTACTS = "contacts"
    ROUTING = "routing"
    ANALYTICS = "analytics"
    PERSIST = "persist"
    COMPLETE = "complete"


class SiteRole(StrEnum):
    """Роль наземного пункта (`03_GLOSSARY.md` §3.5)."""

    CLIENT = "client"
    GATEWAY = "gateway"


class OutageCause(StrEnum):
    """Причина отсутствия маршрута (`03_GLOSSARY.md` §3.1, ADR-005)."""

    NO_CLIENT_COVERAGE = "NO_CLIENT_COVERAGE"
    GATEWAY_OUTAGE = "GATEWAY_OUTAGE"
    NO_GATEWAY_COVERAGE = "NO_GATEWAY_COVERAGE"
    NETWORK_PARTITION = "NETWORK_PARTITION"
    INTERNAL_INCONSISTENCY = "INTERNAL_INCONSISTENCY"


class EdgeKind(StrEnum):
    """Вид ребра графа отсчёта.

    В `05_API.md` §1 показано единственное значение `isl`, но граф содержит и наземные
    линии клиент-спутник и шлюз-спутник (`04_CORE.md` §1), поэтому их вид назван явно.
    Расхождение зафиксировано в `reports/M0-B.md`.
    """

    ISL = "isl"
    GROUND = "ground"


# Значение параметра сценария в diff и в точке эксперимента. Углы и доли приходят числами,
# идентификаторы плоскостей и шлюзов - строками, launch_stage - целым.
ParameterValue: TypeAlias = bool | int | float | str | None


class ParameterChange(BaseModel):
    """Изменение одного параметра сценария относительно родительского варианта."""

    # `from` - ключевое слово Python, поэтому поле называется `from_`, а в JSON уходит
    # под именем из контракта.
    model_config = ConfigDict(populate_by_name=True)

    path: str = Field(
        description="Путь до поля в точечной нотации, например design.planes[1].raan_deg",
    )
    from_: ParameterValue = Field(alias="from", description="Значение до изменения")
    to: ParameterValue = Field(description="Значение после изменения")
