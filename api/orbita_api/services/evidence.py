"""Evidence Pack: всё, чем расчёт подтверждается на защите, одним архивом.

Архив собирается из уже готовых ответов API, а не из отдельных запросов к базе: файл в
нём обязан совпадать с тем, что вернёт соответствующий endpoint, иначе приложенный к
отчёту архив и живая система начнут расходиться.

Время записи у всех файлов одно и то же: zip хранит метку времени в каждой записи, и без
фиксации архив, собранный дважды из одних данных, отличался бы байтами.
"""

from __future__ import annotations

import io
import zipfile
from typing import Final
from uuid import UUID

from orbita_core import ENGINE_VERSION
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry
from orbita_api.schemas.results import OutageInterval
from orbita_api.services import artifacts, comparisons, results

# Метка времени записей архива: `1980-01-01 00:00:00` — начало шкалы формата zip.
_FIXED_TIMESTAMP: Final[tuple[int, int, int, int, int, int]] = (1980, 1, 1, 0, 0, 0)

EXPORT_FILE: Final[str] = "export.json"
METRICS_FILE: Final[str] = "metrics.json"
OUTAGES_FILE: Final[str] = "outages.json"
COMPARISON_FILE: Final[str] = "comparison.json"
RECOMMENDATION_FILE: Final[str] = "recommendation.json"
ENGINE_VERSION_FILE: Final[str] = "engine_version.txt"

# Перерывы отдаются списком верхнего уровня, и в архиве лежит ровно то же, что в ответе
# `GET /api/runs/{id}/outages`: у списка нет своей модели, поэтому нужен адаптер.
_OUTAGES_ADAPTER: Final[TypeAdapter[list[OutageInterval]]] = TypeAdapter(list[OutageInterval])


def pack(files: dict[str, str]) -> bytes:
    """Собирает zip из текстовых файлов в порядке их перечисления."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo(name, date_time=_FIXED_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content.encode("utf-8"))
    return buffer.getvalue()


async def build(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
    base_run_id: UUID | None,
) -> bytes:
    """Архив запуска; при заданной базе — вместе со сравнением и рекомендацией.

    Без базового запуска сравнивать не с чем, и класть в архив пустые файлы вместо
    сравнения значило бы делать вид, что вывод есть.
    """
    metrics = await results.run_metrics(session, run_id)
    outages = await results.run_outages(session, run_id)
    files = {
        EXPORT_FILE: await results.run_export(session, storage, run_id),
        METRICS_FILE: metrics.model_dump_json(indent=2),
        OUTAGES_FILE: _OUTAGES_ADAPTER.dump_json(outages, indent=2).decode("utf-8"),
        ENGINE_VERSION_FILE: f"{ENGINE_VERSION}\n",
    }
    if base_run_id is not None:
        comparison = await comparisons.compare(session, [base_run_id, run_id])
        recommendation = await comparisons.recommend(session, run_id, base_run_id)
        files[COMPARISON_FILE] = comparison.model_dump_json(indent=2, by_alias=True)
        files[RECOMMENDATION_FILE] = recommendation.model_dump_json(indent=2, by_alias=True)

    archive = pack(files)
    await artifacts.store_evidence_pack(session, run_id, archive, storage)
    return archive
