import asyncio

import boto3
from botocore.config import Config

from orbita_api.schemas import ServiceName


class MinioProbe:
    """Проверяет S3-совместимое хранилище трасс и Evidence Pack (06_STORAGE.md §5).

    boto3 синхронный, поэтому вызов уходит в отдельный поток: иначе он заблокирует
    цикл событий api на время своих сетевых таймаутов.
    """

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        region: str,
        timeout_s: float,
    ) -> None:
        config = Config(
            connect_timeout=timeout_s,
            read_timeout=timeout_s,
            # Повторы botocore умножали бы таймаут пробы на число попыток.
            retries={"max_attempts": 0},
            signature_version="s3v4",
        )
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=config,
        )

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
