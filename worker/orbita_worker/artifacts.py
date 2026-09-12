"""Точка подключения хранилища артефактов.

Трасса Run — объект в MinIO (ADR-010), и адаптер к нему живёт в api. Воркер знает о нём
ровно одно: после успешного расчёта кто-то сохраняет артефакты и возвращает ключ трассы
вместе с отметкой о том, пришлось ли писать мимо внешних хранилищ. Пока хранилище не
подключено, ключа нет, и снимок восстанавливается повторным расчётом из сценария — ровно
так же, как после истечения TTL трассы (`06_STORAGE.md` §6).
"""

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from orbita_core.engine import RunResult


@dataclass(frozen=True, slots=True)
class StoredArtifacts:
    """Чем закончилось сохранение артефактов запуска.

    `trace_uri` попадает в `runs.trace_uri`, `degraded_mode` — в `runs.degraded_mode`:
    результат обязан помнить, в каких условиях он записан, а не только то, где лежит.
    """

    trace_uri: str | None
    degraded_mode: bool


class ArtifactSink(Protocol):
    """Сохранение артефактов завершённого расчёта."""

    async def __call__(self, run_id: UUID, result: RunResult) -> StoredArtifacts: ...


async def metrics_only(run_id: UUID, result: RunResult) -> StoredArtifacts:
    """Реализация по умолчанию: в Postgres остаются метрики, артефакты не сохраняются.

    Хранилища у такого запуска нет вовсе, поэтому он помечается degraded: трасса не
    записана, и снимок придётся пересчитывать из сценария.
    """
    return StoredArtifacts(trace_uri=None, degraded_mode=True)
