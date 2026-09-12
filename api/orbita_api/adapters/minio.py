"""MinIO: проба доступности и хранилище артефактов запуска (`06_STORAGE.md` §5–6).

boto3 синхронный, поэтому каждый вызов уходит в отдельный поток: иначе он заблокирует
цикл событий api на время своих сетевых таймаутов.
"""

from __future__ import annotations

import asyncio
from typing import Any, Final, TypeAlias

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from orbita_api.adapters.storage import ArtifactNotFoundError, Retention
from orbita_api.schemas import ServiceName

# Тег, по которому lifecycle-правила бакета удаляют объекты с истёкшим сроком хранения.
RETENTION_TAG: Final[str] = "retention"

# Сроки из `06_STORAGE.md` §6 в днях: меньшей единицы у lifecycle S3 нет, поэтому сутки
# несохранённого интерактивного Run — это один день. `Retention.PROJECT` правила не
# имеет: такие объекты живут до удаления проекта и удаляются приложением.
LIFECYCLE_DAYS: Final[dict[Retention, int]] = {
    Retention.INTERACTIVE: 1,
    Retention.SWEEP_POINT: 7,
}

# Регион, в котором S3 запрещает передавать `CreateBucketConfiguration`.
_DEFAULT_REGION: Final[str] = "us-east-1"

# Ответы, означающие «бакет уже есть»: два разных кода на случай гонки двух процессов,
# одновременно создающих бакет.
_BUCKET_EXISTS_CODES: Final[frozenset[str]] = frozenset(
    {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"},
)
_NOT_FOUND_CODES: Final[frozenset[str]] = frozenset({"404", "NoSuchKey", "NoSuchBucket"})

# boto3 поставляется без аннотаций, поэтому проверке типов клиент виден как `Any`. Имя
# нужно читателю: иначе непонятно, что за объект ходит между методами.
S3Client: TypeAlias = Any


def _error_code(error: ClientError) -> str:
    return str(error.response.get("Error", {}).get("Code", ""))


def build_client(
    endpoint: str,
    access_key: str,
    secret_key: str,
    region: str,
    connect_timeout_s: float,
    read_timeout_s: float,
) -> S3Client:
    """Клиент S3 с раздельными таймаутами.

    Соединение обрывается быстро: недоступный MinIO обязан обнаруживаться за время пробы.
    Чтение и запись ждут дольше — трасса крупной группировки измеряется мегабайтами.
    """
    config = Config(
        connect_timeout=connect_timeout_s,
        read_timeout=read_timeout_s,
        # Повторы botocore умножали бы таймаут на число попыток, а решение о запасном
        # хранилище принимается выше и один раз.
        retries={"max_attempts": 0},
        signature_version="s3v4",
    )
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=config,
    )


class MinioProbe:
    """Проверяет S3-совместимое хранилище трасс и Evidence Pack (06_STORAGE.md §5)."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str,
        timeout_s: float,
    ) -> None:
        self._client = build_client(endpoint, access_key, secret_key, region, timeout_s, timeout_s)

    @property
    def service(self) -> ServiceName:
        return ServiceName.MINIO

    def _list_buckets(self) -> bool:
        # list_buckets проверяет и сеть, и подпись запроса: неверный ключ доступа
        # обнаружится здесь, а не при первой записи трассы.
        self._client.list_buckets()
        return True

    async def ping(self) -> bool:
        return await asyncio.to_thread(self._list_buckets)

    async def aclose(self) -> None:
        await asyncio.to_thread(self._client.close)


class MinioArtifactStore:
    """Трассы, экспорт и Evidence Pack в бакете MinIO.

    Бакет и lifecycle-правила создаются при первом обращении, а не миграцией: api и
    worker поднимаются раньше MinIO и не должны падать, если хранилище ещё не готово.
    """

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str,
        bucket: str,
        connect_timeout_s: float,
        read_timeout_s: float,
    ) -> None:
        self._client = build_client(
            endpoint,
            access_key,
            secret_key,
            region,
            connect_timeout_s,
            read_timeout_s,
        )
        self._region = region
        self._bucket = bucket
        self._bucket_ready = False

    @property
    def bucket(self) -> str:
        return self._bucket

    def _create_bucket(self) -> None:
        arguments: dict[str, Any] = {"Bucket": self._bucket}
        if self._region != _DEFAULT_REGION:
            arguments["CreateBucketConfiguration"] = {"LocationConstraint": self._region}
        try:
            self._client.create_bucket(**arguments)
        except ClientError as error:
            if _error_code(error) not in _BUCKET_EXISTS_CODES:
                raise

    def _put_lifecycle(self) -> None:
        """TTL трасс по `06_STORAGE.md` §6 — правилами бакета, а не задачей по расписанию.

        Фильтр по тегу, а не по префиксу: трасса и экспорт одного запуска лежат под общим
        префиксом `runs/{run_id}/`, но живут разное время.
        """
        rules = [
            {
                "ID": f"orbita-{retention.value}",
                "Status": "Enabled",
                "Filter": {"Tag": {"Key": RETENTION_TAG, "Value": retention.value}},
                "Expiration": {"Days": days},
            }
            for retention, days in LIFECYCLE_DAYS.items()
        ]
        self._client.put_bucket_lifecycle_configuration(
            Bucket=self._bucket,
            LifecycleConfiguration={"Rules": rules},
        )

    def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError as error:
            if _error_code(error) not in _NOT_FOUND_CODES:
                raise
            self._create_bucket()
            self._put_lifecycle()
        self._bucket_ready = True

    def _put(self, key: str, data: bytes, content_type: str, retention: Retention) -> str:
        self._ensure_bucket()
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            Tagging=f"{RETENTION_TAG}={retention.value}",
        )
        return f"s3://{self._bucket}/{key}"

    def _get(self, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            if _error_code(error) in _NOT_FOUND_CODES:
                raise ArtifactNotFoundError(key) from error
            raise
        body: bytes = response["Body"].read()
        return body

    def _exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            if _error_code(error) in _NOT_FOUND_CODES:
                return False
            raise
        return True

    def _delete(self, key: str) -> None:
        # S3 считает удаление отсутствующего объекта успехом; отдельной проверки не нужно.
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def _ping(self) -> bool:
        self._client.list_buckets()
        return True

    async def put(self, key: str, data: bytes, content_type: str, retention: Retention) -> str:
        return await asyncio.to_thread(self._put, key, data, content_type, retention)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._get, key)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._exists, key)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._delete, key)

    async def ping(self) -> bool:
        return await asyncio.to_thread(self._ping)

    async def aclose(self) -> None:
        await asyncio.to_thread(self._client.close)
