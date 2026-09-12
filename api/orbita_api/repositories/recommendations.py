"""Выборки и запись таблицы `recommendations`."""

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.db import models


class RecommendationRepository:
    """Сохранённые выводы сравнения (ADR-006)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def replace_for_base(
        self,
        base_run_id: UUID,
        recommendation: models.Recommendation,
    ) -> None:
        """Оставляет одну рекомендацию на базовый запуск — последнюю.

        Набор кандидатов растёт вместе с проектом, и вывод относительно того же базового
        варианта меняется. Хранить все промежуточные ответы незачем: интересен текущий,
        а история правок конфигурации живёт в вариантах (ADR-011). Транзакцию закрывает
        вызывающий.
        """
        await self._session.execute(
            delete(models.Recommendation).where(
                models.Recommendation.base_run_id == base_run_id,
            ),
        )
        self._session.add(recommendation)
