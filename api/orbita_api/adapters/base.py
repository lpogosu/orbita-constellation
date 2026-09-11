import asyncio
from typing import Protocol, runtime_checkable

from orbita_api.schemas import ServiceName, ServiceStatus


@runtime_checkable
class ServiceProbe(Protocol):
    """Проба доступности одного внешнего сервиса.

    Реализация обращается к сервису напрямую и возвращает `True`, если он отвечает.
    Гасить исключения и следить за таймаутом — задача `probe_status`, чтобы у всех
    хранилищ было одинаковое поведение при отказе.
    """

    @property
    def service(self) -> ServiceName: ...

    async def ping(self) -> bool: ...

    async def aclose(self) -> None: ...


async def probe_status(probe: ServiceProbe, timeout_s: float) -> ServiceStatus:
    """Превращает результат пробы в статус, не давая отказу хранилища уронить api.

    Недоступный Memgraph или MinIO — штатная ситуация degraded mode (06_STORAGE.md §7),
    поэтому любая ошибка и любое зависание сверх таймаута означают `down`, а не 500.
    """
    try:
        alive = await asyncio.wait_for(probe.ping(), timeout=timeout_s)
    except Exception:
        return ServiceStatus.DOWN
    return ServiceStatus.UP if alive else ServiceStatus.DOWN
