"""HTTP-слой ОРБИТЫ.

Расчёты живут в `orbita_core`; здесь только валидация запросов, вызов сервисов
приложения и сериализация ответов (ADR-001).
"""

from typing import Final

API_VERSION: Final[str] = "0.1.0"

__all__ = ["API_VERSION"]
