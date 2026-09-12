"""Локальные реализации хранилищ для degraded mode (`06_STORAGE.md` §7).

Обязательный расчёт обязан завершаться при недоступных MinIO и Memgraph, поэтому у
каждого внешнего хранилища есть замена: файловый каталог вместо объектного хранилища и
пустая заглушка вместо графовой базы. Граф обслуживает только необязательные функции
(ADR-009), и терять из-за него результат расчёта нельзя.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any
from uuid import UUID

from orbita_core.contacts import ContactPlan

from orbita_api.adapters.storage import (
    ArtifactNotFoundError,
    ContactInterval,
    LineageEdge,
    Retention,
)


class LocalArtifactStore:
    """Артефакты в каталоге на диске: ключ становится путём относительно корня.

    Срок хранения здесь не соблюдается: автоматической уборки нет, `expires_at` остаётся
    в Postgres. Локальное хранилище — запасной путь на время недоступности MinIO, а не
    постоянное место для трасс.
    """

    def __init__(self, root: Path) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        return self._root

    def _path(self, key: str) -> Path:
        # Ключи формируются кодом из `storage.artifact_key`, но проверка дешевле разбора
        # последствий: путь обязан остаться внутри корня.
        candidate = (self._root / key).resolve()
        root = self._root.resolve()
        if root != candidate and root not in candidate.parents:
            raise ValueError(f"ключ {key} уводит за пределы каталога артефактов")
        return candidate

    def _write(self, key: str, data: bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Запись во временный файл рядом и переименование: читатель никогда не увидит
        # наполовину записанную трассу, даже если процесс упадёт посреди записи.
        temporary = path.with_name(f"{path.name}.partial")
        temporary.write_bytes(data)
        os.replace(temporary, path)
        return path.as_uri()

    def _read(self, key: str) -> bytes:
        path = self._path(key)
        try:
            return path.read_bytes()
        except FileNotFoundError as error:
            raise ArtifactNotFoundError(key) from error

    async def put(self, key: str, data: bytes, content_type: str, retention: Retention) -> str:
        """Тип содержимого и срок хранения файловой системе сказать некому.

        Оба значения остаются в таблице `artifacts`: вид артефакта известен по колонке
        `kind`, срок — по `expires_at`.
        """
        return await asyncio.to_thread(self._write, key, data)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._read, key)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).is_file)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._path(key).unlink, True)

    def _writable(self) -> bool:
        try:
            self._root.mkdir(parents=True, exist_ok=True)
        except OSError:
            return False
        return os.access(self._root, os.W_OK)

    async def ping(self) -> bool:
        """Каталог существует и доступен на запись: иначе запасной путь не спасёт."""
        return await asyncio.to_thread(self._writable)

    async def aclose(self) -> None:
        """Файловому хранилищу нечего закрывать; метод нужен общему интерфейсу."""


class NullGraphStore:
    """Заглушка графового хранилища: запись игнорируется, чтение пусто.

    Такая реализация лучше исключения: Experiment Lineage и графовые запросы —
    необязательные функции, их отсутствие должно выглядеть как пустой ответ и отметка
    `degraded_mode`, а не как ошибка расчёта.
    """

    @property
    def persistent(self) -> bool:
        return False

    async def save_run_graph(
        self,
        run_id: UUID,
        engine_version: str,
        routing_policy: str,
        plan: ContactPlan,
        plane_ids: Mapping[str, str],
    ) -> None:
        """Граф отбрасывается: он нужен только необязательным функциям (ADR-009)."""

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
        """Происхождение вариантов целиком лежит и в Postgres: колонки `parent_variant_id`
        и `diff_from_parent` остаются источником истины для `GET /api/projects/{id}/lineage`.
        """

    async def contacts_of(self, run_id: UUID, node_id: str) -> tuple[ContactInterval, ...]:
        """Пусто: интерфейс покажет, что графовые запросы недоступны."""
        return ()

    async def lineage(self, project_id: UUID) -> tuple[LineageEdge, ...]:
        """Пусто: происхождение вариантов читается из Postgres."""
        return ()

    async def delete_run(self, run_id: UUID) -> None:
        """Удалять нечего: заглушка ничего не сохранила."""

    async def ping(self) -> bool:
        """Заглушка доступна всегда: у неё нет ни сети, ни диска."""
        return True

    async def aclose(self) -> None:
        """Соединений нет; метод нужен общему интерфейсу."""
