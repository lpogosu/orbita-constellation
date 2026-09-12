from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageMode(StrEnum):
    """Как выбираются хранилища артефактов и графа.

    `auto` подходит и для полного стека, и для degraded: адаптер выбирается по ответу
    хранилища. Явные режимы нужны, чтобы воспроизвести поведение без остановки сервисов:
    `local` заставляет работать на локальных адаптерах при живом MinIO, `full` запрещает
    тихо съехать на них, когда внешние хранилища обязаны работать.
    """

    AUTO = "auto"
    LOCAL = "local"
    FULL = "full"


class Settings(BaseSettings):
    """Адреса внешних хранилищ и параметры проб доступности.

    Значения по умолчанию — имена сервисов из `deploy/docker-compose.yml`, поэтому
    контейнер api работает без дополнительной настройки, а локальный запуск и профиль
    `degraded` переопределяют их переменными окружения.
    """

    model_config = SettingsConfigDict(env_prefix="ORBITA_", extra="ignore")

    postgres_dsn: str = "postgresql+asyncpg://orbita:orbita@postgres:5432/orbita"
    redis_url: str = "redis://redis:6379/0"
    memgraph_url: str = "bolt://memgraph:7687"
    memgraph_user: str = ""
    memgraph_password: str = ""
    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = "orbita"
    minio_secret_key: str = "orbita-secret"
    minio_region: str = "us-east-1"
    minio_bucket: str = "orbita"

    storage_mode: StorageMode = StorageMode.AUTO

    # Куда пишутся артефакты, когда MinIO недоступен. В контейнере путь переопределяется
    # на том, иначе трассы исчезнут вместе с контейнером.
    artifacts_dir: Path = Path("var/artifacts")

    # Запись трассы — не проба доступности: мегабайты по сети идут дольше секунды.
    storage_timeout_s: float = 15.0

    # Ключ, в который arq записывает отметку живости воркера. Значение должно совпадать
    # с `WORKER_HEALTH_KEY` в `worker/orbita_worker/settings.py`: это единственный
    # контракт между api и воркером, помимо самой очереди.
    worker_health_key: str = "arq:queue:health-check"

    # Health не имеет права висеть: страница состояния должна отвечать даже тогда, когда
    # хранилище не отвечает вовсе, а не только когда оно отказывает быстро.
    probe_timeout_s: float = 1.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
