"""Сохранение артефактов завершённого запуска.

Расчёт к моменту вызова уже выполнен, а метрики лежат в незакоммиченной транзакции.
Поэтому ни один сбой внешнего хранилища не имеет права всплыть наружу исключением:
трасса уходит в локальный каталог, запуск помечается `degraded_mode`, и транзакция с
метриками доходит до коммита (`06_STORAGE.md` §7).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final
from uuid import UUID

from orbita_core.contacts import ContactPlan
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageBundle, StorageRegistry
from orbita_api.adapters.storage import (
    RETENTION_PERIOD,
    ArtifactKind,
    ArtifactStore,
    Retention,
    artifact_key,
    content_type,
)
from orbita_api.db import models
from orbita_api.error_handling import EntityNotFoundError
from orbita_api.repositories import ArtifactRepository, RunRepository, VariantRepository
from orbita_api.services import trace_codec

logger = logging.getLogger(__name__)

RUN_ENTITY: Final[str] = "Запуск"
VARIANT_ENTITY: Final[str] = "Вариант"


@dataclass(frozen=True, slots=True)
class PersistReport:
    """Чем закончилось сохранение: куда легли объекты и был ли задействован запасной путь."""

    degraded_mode: bool
    trace_uri: str
    export_uri: str
    graph_saved: bool


def _expires_at(retention: Retention) -> datetime | None:
    period = RETENTION_PERIOD[retention]
    return None if period is None else datetime.now(UTC) + period


def _plane_ids(scenario: dict[str, Any]) -> dict[str, str]:
    """Плоскость каждого аппарата из канонического сценария варианта.

    `ContactPlan` плоскостей не содержит - расчёту они не нужны, - а узел графа обязан
    их знать (`06_STORAGE.md` §4).
    """
    satellites = scenario.get("design", {}).get("satellites", [])
    return {str(item["id"]): str(item["plane_id"]) for item in satellites}


async def _put_or_fallback(
    bundle: StorageBundle,
    fallback: ArtifactStore,
    key: str,
    data: bytes,
    kind: ArtifactKind,
    retention: Retention,
) -> tuple[str, bool]:
    """Пишет объект, при отказе внешнего хранилища повторяя запись локально.

    Ловится любое исключение: у адаптеров разных хранилищ нет общего типа ошибки, а
    список из `ClientError`, таймаутов и ошибок сети пришлось бы дополнять при каждой
    смене драйвера. Отказ локального хранилища не перехватывается: если недоступен и
    он, сохранять трассу негде, и вызывающий должен об этом узнать.
    """
    try:
        return await bundle.artifacts.put(key, data, content_type(kind), retention), False
    except Exception:
        logger.warning("Внешнее хранилище отказало, артефакт %s уходит локально", key)
        return await fallback.put(key, data, content_type(kind), retention), True


def _register(
    repository: ArtifactRepository,
    run_id: UUID,
    kind: ArtifactKind,
    uri: str,
    size_bytes: int,
    retention: Retention,
) -> None:
    repository.add(
        models.Artifact(
            run_id=run_id,
            kind=str(kind),
            uri=uri,
            size_bytes=size_bytes,
            expires_at=_expires_at(retention),
        ),
    )


async def persist_run_artifacts(
    session: AsyncSession,
    run_id: UUID,
    plan: ContactPlan,
    export_json: bytes,
    storage: StorageRegistry,
    retention: Retention = Retention.INTERACTIVE,
) -> PersistReport:
    """Записывает трассу, экспорт и граф запуска и регистрирует объекты в Postgres.

    Срок хранения по умолчанию — сутки несохранённого интерактивного запуска
    (`06_STORAGE.md` §6); точки sweep и сохранённые варианты передают свой.
    """
    run = await RunRepository(session).get(run_id)
    if run is None:
        raise EntityNotFoundError(RUN_ENTITY, run_id)
    variant = await VariantRepository(session).get(run.variant_id)
    if variant is None:
        raise EntityNotFoundError(VARIANT_ENTITY, run.variant_id)

    bundle = await storage.resolve()
    degraded = bundle.degraded_mode

    trace = trace_codec.encode_trace(plan)
    trace_key = artifact_key(run_id, ArtifactKind.TRACE)
    trace_uri, trace_fallback = await _put_or_fallback(
        bundle,
        storage.local_artifacts,
        trace_key,
        trace,
        ArtifactKind.TRACE,
        retention,
    )
    export_key = artifact_key(run_id, ArtifactKind.EXPORT)
    export_uri, export_fallback = await _put_or_fallback(
        bundle,
        storage.local_artifacts,
        export_key,
        export_json,
        ArtifactKind.EXPORT,
        # Экспорт живёт до удаления проекта (`06_STORAGE.md` §6): он мог уйти в отчёт,
        # и его исчезновение через сутки выглядело бы потерей результата.
        Retention.PROJECT,
    )
    degraded = degraded or trace_fallback or export_fallback

    repository = ArtifactRepository(session)
    await repository.delete_kind(run_id, str(ArtifactKind.TRACE))
    await repository.delete_kind(run_id, str(ArtifactKind.EXPORT))
    _register(repository, run_id, ArtifactKind.TRACE, trace_uri, len(trace), retention)
    _register(
        repository,
        run_id,
        ArtifactKind.EXPORT,
        export_uri,
        len(export_json),
        Retention.PROJECT,
    )
    # Ссылка на трассу лежит и в самом запуске: снимок отсчёта ищет её там, не читая
    # реестр артефактов.
    run.trace_uri = trace_uri
    await session.flush()

    graph_saved = False
    if bundle.graph.persistent:
        try:
            await bundle.graph.save_run_graph(
                run_id,
                run.engine_version,
                str(run.routing_policy),
                plan,
                _plane_ids(variant.scenario),
            )
            graph_saved = True
        except Exception:
            # Граф обслуживает только необязательные функции (ADR-009): его потеря - это
            # degraded mode, а не потеря результата расчёта.
            logger.warning("Граф запуска %s не сохранён, работа продолжается", run_id)
            degraded = True

    return PersistReport(
        degraded_mode=degraded,
        trace_uri=trace_uri,
        export_uri=export_uri,
        graph_saved=graph_saved,
    )
