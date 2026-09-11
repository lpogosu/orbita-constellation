from redis.asyncio import Redis

from orbita_api.schemas import ServiceName


class WorkerProbe:
    """Проверяет живость воркера по отметке, которую arq обновляет в Redis.

    Прямого канала между api и воркером нет: воркер — отдельный процесс, который может
    работать на другой машине. arq периодически записывает в Redis ключ состояния с
    временем жизни чуть больше периода записи, поэтому наличие ключа означает, что
    воркер отчитался недавно, а не когда-то. Имя ключа задаётся в
    `worker/orbita_worker/settings.py` и в настройках api (`ORBITA_WORKER_HEALTH_KEY`).

    Следствие: при недоступном Redis воркер показывается как `down`, даже если процесс
    жив. Это честно — задачи через мёртвую очередь до него всё равно не дойдут.
    """

    def __init__(self, client: Redis, health_key: str) -> None:
        self._client = client
        self._health_key = health_key

    @property
    def service(self) -> ServiceName:
        return ServiceName.WORKER

    async def ping(self) -> bool:
        return bool(await self._client.exists(self._health_key))

    async def aclose(self) -> None:
        # Клиент Redis общий с RedisProbe и закрывается там: закрывать его дважды нельзя.
        return
