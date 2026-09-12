import asyncio

from orbita_core import ENGINE_VERSION

from orbita_worker.jobs import ping
from orbita_worker.keys import WORKER_HEALTH_KEY
from orbita_worker.settings import HEALTH_CHECK_INTERVAL_S, WorkerSettings


def test_ping_reports_engine_version_and_job_id() -> None:
    """Ответ задачи позволяет сверить версию ядра воркера с версией api (ADR-011)."""
    result = asyncio.run(ping({"job_id": "job-1"}))

    assert result["engine_version"] == ENGINE_VERSION
    assert result["job_id"] == "job-1"


def test_worker_registers_at_least_one_function() -> None:
    """arq отказывается стартовать с пустым списком функций."""
    assert WorkerSettings.functions


def test_health_key_matches_api_contract() -> None:
    """Имя ключа живости знает и api: расхождение сделает воркер вечно `down`."""
    assert WORKER_HEALTH_KEY == "arq:queue:health-check"
    assert WorkerSettings.health_check_key == WORKER_HEALTH_KEY
    assert WorkerSettings.health_check_interval == HEALTH_CHECK_INTERVAL_S
