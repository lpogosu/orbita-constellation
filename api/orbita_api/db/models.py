"""Таблицы Postgres (`06_STORAGE.md` §3).

Схема повторяет состав таблиц документа. Значения enum хранятся строками с ограничением
CHECK, а не отдельными типами Postgres: тип пришлось бы менять миграцией на каждое новое
значение глоссария, а выигрыша в месте он не даёт.

Связи объявлены только внешними ключами, без `relationship`: в асинхронной сессии ленивая
загрузка бросает исключение, поэтому все выборки делает репозиторий явным запросом.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any, ClassVar, Final

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from orbita_api.schemas.common import OutageCause, RoutingPolicy, RunStage, RunStatus
from orbita_api.schemas.projects import TITLE_MAX_LENGTH

# Имена ограничений задаются соглашением, а не Postgres: иначе имя зависит от порядка
# создания объектов и следующая миграция не может сослаться на него.
NAMING_CONVENTION: Final[dict[str, str]] = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Самое длинное значение глоссария — `INTERNAL_INCONSISTENCY`, 23 символа. Запас нужен,
# чтобы добавление значения в §3 не требовало менять длину колонки.
ENUM_LENGTH: Final[int] = 32

# Идентификаторы узлов приходят из файла сценария и ограничены только здравым смыслом;
# 64 символа покрывают любой разумный файл.
NODE_ID_LENGTH: Final[int] = 64
HASH_LENGTH: Final[int] = 64
URI_LENGTH: Final[int] = 500

# Длина колонки названия равна пределу контракта: длинное название должно отвергаться
# ответом 400 с указанием поля, а не ошибкой драйвера.
TITLE_LENGTH: Final[int] = TITLE_MAX_LENGTH

# Служебные строки, которые пользователь не вводит: версия ядра, вид артефакта, вид
# задачи. Ограничение защищает от мусора, а не от пользователя.
NAME_LENGTH: Final[int] = 200


def string_enum(enum_class: type[enum.Enum], constraint_name: str) -> Enum:
    """Строковая колонка со списком допустимых значений в CHECK.

    `constraint_name` — роль колонки (`status`, `stage`); имя таблицы к нему добавляет
    соглашение об именах, поэтому ограничение называется `ck_runs_status`.

    `values_callable` заставляет SQLAlchemy писать значения членов перечисления
    (`bfs_shortest`), а не их имена (`BFS_SHORTEST`): в базе должны лежать ровно те
    строки, которые объявлены глоссарием и уходят в API.
    """
    return Enum(
        enum_class,
        name=constraint_name,
        native_enum=False,
        create_constraint=True,
        length=ENUM_LENGTH,
        values_callable=lambda members: [str(member.value) for member in members],
    )


# Запуски в этих состояниях занимают конфигурацию: готовый переиспользуется (ADR-011),
# а поставленный в очередь или считающийся уже отвечает на тот же вопрос. Упавшие и
# отменённые не занимают ничего - их перезапускают.
ACTIVE_RUN_STATUSES: Final[tuple[RunStatus, ...]] = (
    RunStatus.QUEUED,
    RunStatus.RUNNING,
    RunStatus.SUCCEEDED,
)

# Предикат частичного индекса. Собирается из того же кортежа, что и запросы сервиса:
# разойдись они, дедупликация и индекс начали бы считать разные множества запусков.
ACTIVE_RUN_PREDICATE: Final[str] = "status IN ({})".format(
    ", ".join(f"'{status.value}'" for status in ACTIVE_RUN_STATUSES),
)


class Base(DeclarativeBase):
    """Общий предок таблиц: соглашение об именах и типы, общие для всей схемы."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map: ClassVar[dict[Any, Any]] = {
        # Структуры произвольной формы (сценарий, diff, параметры точки sweep) лежат в
        # JSONB: по ним нужны выборки, и запрос не должен разбирать текст.
        dict[str, Any]: JSONB,
        list[Any]: JSONB,
        datetime: DateTime(timezone=True),
    }


class Project(Base):
    """Контейнер инженерного исследования: варианты, запуски, эксперименты."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(TITLE_LENGTH))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # Ссылка на вариант из таблицы, которая сама ссылается на проект. Цикл разрывается
    # так: проект создаётся без активного варианта, затем первый Variant проставляет его.
    # `use_alter` откладывает создание ключа до появления обеих таблиц.
    active_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "variants.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_projects_active_variant_id_variants",
        ),
    )


class Variant(Base):
    """Неизменяемая версия сценария с diff от родителя (ADR-011).

    `config_hash` варианта — sha256 канонического сценария **без** политики
    маршрутизации: политика к сценарию не относится и выбирается при запуске. Ключ
    переиспользования готового Run считается иначе, `config_hash(scenario, policy)` из
    ядра, и хранится в `runs.config_hash`.
    """

    __tablename__ = "variants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    parent_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("variants.id", ondelete="CASCADE"),
    )
    title: Mapped[str] = mapped_column(String(TITLE_LENGTH))
    scenario: Mapped[dict[str, Any]]
    diff_from_parent: Mapped[list[Any]]
    config_hash: Mapped[str] = mapped_column(String(HASH_LENGTH))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Run(Base):
    """Выполнение расчёта конкретного варианта конкретной версией ядра."""

    __tablename__ = "runs"
    __table_args__ = (
        # Дедупликация ADR-011: готовый Run переиспользуется только при совпадении
        # `config_hash` и `engine_version`, поэтому пара уникальна. Уникальность частичная:
        # упавший и отменённый запуск обязаны допускать перезапуск той же конфигурации,
        # иначе одна ошибка расчёта закрыла бы конфигурацию навсегда.
        Index(
            "uq_runs_config_hash_engine_version",
            "config_hash",
            "engine_version",
            unique=True,
            postgresql_where=text(ACTIVE_RUN_PREDICATE),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("variants.id", ondelete="CASCADE"),
        index=True,
    )
    routing_policy: Mapped[RoutingPolicy] = mapped_column(
        string_enum(RoutingPolicy, "routing_policy"),
    )
    engine_version: Mapped[str] = mapped_column(String(NAME_LENGTH))
    config_hash: Mapped[str] = mapped_column(String(HASH_LENGTH))
    status: Mapped[RunStatus] = mapped_column(string_enum(RunStatus, "status"))
    stage: Mapped[RunStage] = mapped_column(string_enum(RunStage, "stage"))
    progress: Mapped[float] = mapped_column(Float)
    completed_ticks: Mapped[int] = mapped_column(Integer)
    total_ticks: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column()
    finished_at: Mapped[datetime | None] = mapped_column()
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    trace_uri: Mapped[str | None] = mapped_column(String(URI_LENGTH))
    # Артефакты запуска легли мимо внешних хранилищ: трасса в локальном каталоге, граф не
    # сохранён (`06_STORAGE.md` §7). Признак принадлежит запуску, а не ответу: результат
    # уже посчитан, и открывший его через сутки обязан видеть, в каких условиях он записан.
    degraded_mode: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    error: Mapped[dict[str, Any] | None] = mapped_column()
    # В `06_STORAGE.md` §3 у runs нет отдельной даты создания, но список «последних Run»
    # проекта надо чем-то упорядочивать: `started_at` пуст, пока задача стоит в очереди.
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ClientMetrics(Base):
    """Метрики одного клиента за горизонт (`05_API.md` §1).

    Ключ составной: у запуска ровно одна строка на клиента, и суррогатный идентификатор
    ничего бы не добавил.
    """

    __tablename__ = "client_metrics"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    client_id: Mapped[str] = mapped_column(String(NODE_ID_LENGTH), primary_key=True)
    availability: Mapped[float] = mapped_column(Float)
    visibility: Mapped[float] = mapped_column(Float)
    max_gap_s: Mapped[int] = mapped_column(Integer)
    # Переходы считаются только по отсчётам с маршрутом: у клиента, который не дотянулся
    # до шлюза ни разу, значения нет, и ноль был бы ложью (`05_API.md` §1).
    mean_hops: Mapped[float | None] = mapped_column(Float)
    max_hops: Mapped[int | None] = mapped_column(Integer)
    route_switches: Mapped[int] = mapped_column(Integer)
    target_met: Mapped[bool] = mapped_column()
    outage_count_by_cause: Mapped[dict[str, Any]]


class ConfigMetrics(Base):
    """Метрики конфигурации целиком: одна строка на запуск."""

    __tablename__ = "config_metrics"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    min_client_availability: Mapped[float] = mapped_column(Float)
    mean_client_availability: Mapped[float] = mapped_column(Float)
    worst_max_gap_s: Mapped[int] = mapped_column(Integer)
    mean_hops: Mapped[float | None] = mapped_column(Float)
    max_hops: Mapped[int | None] = mapped_column(Integer)
    route_switches_total: Mapped[int] = mapped_column(Integer)
    # Пусто, если резервные маршруты не считались или ни один клиент не имел маршрута.
    backup_path_count_min: Mapped[int | None] = mapped_column(Integer)
    outage_count_by_cause: Mapped[dict[str, Any]]
    target_met_clients: Mapped[list[Any]]


class OutageInterval(Base):
    """Непрерывный перерыв связи одного клиента с доказательством причины (ADR-005)."""

    __tablename__ = "outage_intervals"
    __table_args__ = (
        # Экран Outage Detective открывает перерывы выбранного клиента одного запуска.
        Index("ix_outage_intervals_run_id_client_id", "run_id", "client_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    client_id: Mapped[str] = mapped_column(String(NODE_ID_LENGTH))
    start_s: Mapped[int] = mapped_column(Integer)
    end_s: Mapped[int] = mapped_column(Integer)
    truncated_by_horizon: Mapped[bool] = mapped_column()
    primary_cause: Mapped[OutageCause] = mapped_column(
        string_enum(OutageCause, "primary_cause"),
    )
    causes: Mapped[list[Any]]
    evidence: Mapped[dict[str, Any]]


class Experiment(Base):
    """Sweep по одной или двум осям с бюджетом."""

    __tablename__ = "experiments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    base_variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("variants.id", ondelete="CASCADE"),
    )
    axes: Mapped[list[Any]]
    budget: Mapped[dict[str, Any]]
    routing_policy: Mapped[RoutingPolicy] = mapped_column(
        string_enum(RoutingPolicy, "routing_policy"),
    )
    status: Mapped[RunStatus] = mapped_column(string_enum(RunStatus, "status"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ExperimentPoint(Base):
    """Одна конфигурация внутри sweep с её метриками.

    Метрики пустые, пока точка не посчитана: она заводится заранее, чтобы heatmap
    показывал прогресс. `run_id` обнуляется вместе с удалённым по TTL запуском — сама
    точка переживает его (`06_STORAGE.md` §6).
    """

    __tablename__ = "experiment_points"
    __table_args__ = (Index("ix_experiment_points_experiment_id", "experiment_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    experiment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"),
    )
    params: Mapped[dict[str, Any]]
    config_hash: Mapped[str] = mapped_column(String(HASH_LENGTH))
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"))
    min_client_availability: Mapped[float | None] = mapped_column(Float)
    worst_max_gap_s: Mapped[int | None] = mapped_column(Integer)
    mean_client_availability: Mapped[float | None] = mapped_column(Float)


class Recommendation(Base):
    """Детерминированный вывод из метрик двух запусков (ADR-006)."""

    __tablename__ = "recommendations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    base_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    recommended_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"),
    )
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Job(Base):
    """Журнал задач воркера.

    Очередь живёт в Redis (`06_STORAGE.md` §3); эта таблица хранит историю попыток и
    ошибок, поэтому внешнего ключа на `runs` у неё нет: задача может не дойти до создания
    запуска, и её след всё равно обязан сохраниться.
    """

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(NAME_LENGTH))
    payload: Mapped[dict[str, Any]]
    status: Mapped[RunStatus] = mapped_column(string_enum(RunStatus, "status"))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    enqueued_at: Mapped[datetime] = mapped_column(server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column()
    finished_at: Mapped[datetime | None] = mapped_column()
    error: Mapped[dict[str, Any] | None] = mapped_column()


class Artifact(Base):
    """Объект в MinIO, принадлежащий запуску: трасса, экспорт, Evidence Pack."""

    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"),
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(NAME_LENGTH))
    uri: Mapped[str] = mapped_column(String(URI_LENGTH))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # Пусто у артефактов, которые живут до удаления проекта (`06_STORAGE.md` §6).
    expires_at: Mapped[datetime | None] = mapped_column()
