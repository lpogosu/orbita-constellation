"""Канал прогресса и отмена без Redis (`06_STORAGE.md` §5, §7)."""

import asyncio
from uuid import uuid4

from orbita_api.schemas.common import RunStage, RunStatus
from orbita_api.schemas.runs import RunProgressEvent

from orbita_worker.events import LocalRunEvents
from orbita_worker.keys import cancel_key, run_channel


def test_local_events_remember_only_the_cancelled_run() -> None:
    """Отмена в degraded mode адресная: соседний расчёт продолжается."""
    events = LocalRunEvents()
    cancelled = uuid4()
    untouched = uuid4()

    async def scenario() -> tuple[bool, bool]:
        await events.request_cancel(cancelled)
        await events.publish(
            RunProgressEvent(
                run_id=cancelled,
                status=RunStatus.RUNNING,
                stage=RunStage.ROUTING,
                progress=0.5,
                completed_ticks=0,
                total_ticks=1,
            ),
        )
        return await events.is_cancelled(cancelled), await events.is_cancelled(untouched)

    assert asyncio.run(scenario()) == (True, False)


def test_key_names_follow_the_storage_document() -> None:
    """Имена ключей — контракт между api и воркером: разойдись они, прогресс пропадёт."""
    run_id = uuid4()

    assert run_channel(run_id) == f"run:{run_id}"
    assert cancel_key(run_id) == f"run:{run_id}:cancel"
