"""Точка подключения хранилища артефактов.

Трасса Run — объект в MinIO (ADR-010), и адаптер к нему живёт в api. Воркер знает о нём
ровно одно: после успешного расчёта кто-то может сохранить трассу и вернуть её ключ,
который попадёт в `runs.trace_uri`. Пока хранилище не подключено, ключа нет, и снимок
восстанавливается повторным расчётом из сценария — ровно так же, как после истечения TTL
трассы (`06_STORAGE.md` §6).
"""

from typing import Protocol
from uuid import UUID

from orbita_core.engine import RunResult


class ArtifactSink(Protocol):
    """Сохранение артефактов завершённого расчёта.

    Возвращает `trace_uri` — ключ трассы в хранилище — или `None`, если трасса не
    сохранена.
    """

    async def __call__(self, run_id: UUID, result: RunResult) -> str | None: ...


async def metrics_only(run_id: UUID, result: RunResult) -> str | None:
    """Реализация по умолчанию: в Postgres остаются метрики, трасса не сохраняется."""
    return None
