import asyncio
from collections.abc import Awaitable, Callable
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


async def is_alive(ping: Callable[[], Awaitable[bool]], timeout_s: float) -> bool:
    """Отвечает ли хранилище за отведённое время.

    Недоступный Memgraph или MinIO — штатная ситуация degraded mode (06_STORAGE.md §7),
    поэтому любая ошибка и любое зависание сверх таймаута означают «не отвечает», а не
    исключение наружу. Через эту же проверку идёт выбор адаптера в `StorageRegistry`:
    у health и у выбора хранилища должны быть одинаковые таймаут и трактовка отказа.
    """
    try:
        return await asyncio.wait_for(ping(), timeout=timeout_s)
    except Exception:
        return False


async def probe_status(probe: ServiceProbe, timeout_s: float) -> ServiceStatus:
    """Превращает результат пробы в статус, не давая отказу хранилища уронить api."""
    return ServiceStatus.UP if await is_alive(probe.ping, timeout_s) else ServiceStatus.DOWN
