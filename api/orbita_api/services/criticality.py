"""Resilience X-Ray service.

The expensive counterfactual calculation lives in :mod:`orbita_core.resilience`; this
module only resolves a finished run and translates the immutable core report to the HTTP
contract.  ``to_thread`` keeps the FastAPI event loop responsive while preserving the
existing synchronous POST contract used by the web client.
"""

from __future__ import annotations

import asyncio
import threading
from datetime import UTC, datetime
from uuid import UUID

from orbita_core import resilience
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry
from orbita_api.db import models
from orbita_api.repositories.jobs import JobRepository
from orbita_api.schemas.common import RunStatus
from orbita_api.schemas.results import CriticalityReport, SatelliteCriticality
from orbita_api.services import results

_CANCELLED_JOBS: set[UUID] = set()


class CriticalityJobCancelledError(RuntimeError):
    """Raised when a persisted criticality job was cancelled."""


class CriticalityJobInProgressError(RuntimeError):
    """A different API process is already computing this report."""


class CriticalityJobFailedError(RuntimeError):
    """The persisted report failed and has exhausted its retry budget."""


async def run_criticality(
    session: AsyncSession,
    storage: StorageRegistry,
    run_id: UUID,
) -> CriticalityReport:
    """Calculate per-satellite counterfactuals for a completed run.

    Run artifacts already contain the canonical scenario and routing policy.  Reusing
    ``load_context`` means this endpoint follows the same storage/degraded fallback as
    snapshots, timelines and backup paths, and rejects queued/failed runs consistently.
    """
    # The pure adapter is also unit-tested with a mocked context and no database.
    if session is None:  # type: ignore[comparison-overlap]
        context = await results.load_context(session, storage, run_id)
        report = await asyncio.to_thread(resilience.criticality, context.scenario, context.policy)
        return CriticalityReport(
            run_id=run_id,
            satellites=[
                SatelliteCriticality(
                    satellite_id=entry.satellite_id,
                    plane_id=entry.plane_id,
                    delta_min_client_availability=entry.delta_min_client_availability,
                    delta_worst_max_gap_s=entry.delta_worst_max_gap_s,
                    affected_clients=list(entry.affected_clients),
                    min_cut_frequency=entry.min_cut_frequency,
                    articulation_frequency=entry.articulation_frequency,
                )
                for entry in report.satellites
            ],
        )
    jobs = JobRepository(session)
    job = await jobs.find_for_criticality(run_id)
    if job is None:
        job = jobs.enqueue_criticality(run_id)
        await session.commit()
        await session.refresh(job)
    if job.status == RunStatus.CANCELLED:
        raise CriticalityJobCancelledError(f"criticality analysis {job.id} was cancelled")
    if job.status == RunStatus.SUCCEEDED:
        payload = job.payload.get("result") if isinstance(job.payload, dict) else None
        if payload:
            return CriticalityReport.model_validate(payload)
    if job.status == RunStatus.RUNNING:
        return await _wait_for_existing_job(session, job, run_id)
    if job.status == RunStatus.FAILED and int(job.attempts or 0) >= 3:
        raise CriticalityJobFailedError(f"criticality analysis {job.id} failed after 3 attempts")

    job.status = RunStatus.RUNNING
    job.attempts = int(job.attempts or 0) + 1
    job.started_at = datetime.now(UTC)
    job.payload = {**(job.payload or {}), "progress": 0.05}
    await session.commit()
    try:
        if run_id in _CANCELLED_JOBS:
            raise CriticalityJobCancelledError(f"criticality analysis {job.id} was cancelled")
        context = await results.load_context(session, storage, run_id)
        job.payload = {**(job.payload or {}), "progress": 0.1}
        await session.commit()
        loop = asyncio.get_running_loop()
        cancellation_requested = threading.Event()

        async def save_progress(done: int, total: int) -> None:
            current = await JobRepository(session).find_for_criticality(run_id)
            if current is None or current.status == RunStatus.CANCELLED:
                cancellation_requested.set()
                return
            current.payload = {
                **(current.payload or {}),
                "progress": 0.1 + 0.9 * (done / max(total, 1)),
            }
            await session.commit()

        def progress(done: int, total: int) -> None:
            asyncio.run_coroutine_threadsafe(save_progress(done, total), loop).result()

        report = await asyncio.to_thread(
            resilience.criticality,
            context.scenario,
            context.policy,
            progress=progress,
            cancel_check=lambda: cancellation_requested.is_set() or run_id in _CANCELLED_JOBS,
        )
        await session.refresh(job)
        if run_id in _CANCELLED_JOBS or job.status == RunStatus.CANCELLED:
            raise resilience.CriticalityCancelledError(
                f"criticality analysis {job.id} was cancelled",
            )
        result = CriticalityReport(
            run_id=run_id,
            satellites=[
                SatelliteCriticality(
                    satellite_id=entry.satellite_id,
                    plane_id=entry.plane_id,
                    delta_min_client_availability=entry.delta_min_client_availability,
                    delta_worst_max_gap_s=entry.delta_worst_max_gap_s,
                    affected_clients=list(entry.affected_clients),
                    min_cut_frequency=entry.min_cut_frequency,
                    articulation_frequency=entry.articulation_frequency,
                )
                for entry in report.satellites
            ],
        )
        job.status = RunStatus.SUCCEEDED
        job.finished_at = datetime.now(UTC)
        job.payload = {
            **(job.payload or {}),
            "progress": 1.0,
            "result": result.model_dump(mode="json"),
        }
        await session.commit()
        _CANCELLED_JOBS.discard(run_id)
        return result
    except Exception as error:
        cancelled = (
            run_id in _CANCELLED_JOBS
            or job.status == RunStatus.CANCELLED
            or isinstance(
                error,
                (resilience.CriticalityCancelledError, CriticalityJobCancelledError),
            )
        )
        if cancelled:
            job.status = RunStatus.CANCELLED
            job.finished_at = datetime.now(UTC)
            job.payload = {**(job.payload or {}), "progress": 1.0}
            await session.commit()
            _CANCELLED_JOBS.discard(run_id)
            raise CriticalityJobCancelledError(str(error)) from error
        job.status = RunStatus.FAILED
        job.finished_at = datetime.now(UTC)
        job.error = {"message": str(error), "type": error.__class__.__name__}
        job.payload = {**(job.payload or {}), "progress": 1.0}
        await session.commit()
        _CANCELLED_JOBS.discard(run_id)
        raise


async def _wait_for_existing_job(
    session: AsyncSession,
    job: models.Job,
    run_id: UUID,
) -> CriticalityReport:
    """Wait briefly for a report already owned by another API process.

    The public endpoint remains synchronous for the current web client, but it
    must never start a second N-counterfactual calculation for the same Run.
    Callers can use the internal status endpoint if the first worker exceeds the
    response window.
    """
    for _ in range(300):  # 30 seconds, the product budget for Resilience X-Ray
        await asyncio.sleep(0.1)
        await session.refresh(job)
        status = job.status
        if status == RunStatus.SUCCEEDED:
            payload = job.payload.get("result") if isinstance(job.payload, dict) else None
            if payload:
                return CriticalityReport.model_validate(payload)
            raise CriticalityJobFailedError(f"criticality analysis {job.id} has no result")
        if status == RunStatus.CANCELLED:
            raise CriticalityJobCancelledError(f"criticality analysis {job.id} was cancelled")
        if status == RunStatus.FAILED:
            raise CriticalityJobFailedError(f"criticality analysis {job.id} failed")
    raise CriticalityJobInProgressError(f"criticality analysis for run {run_id} is still running")


async def get_criticality_status(session: AsyncSession, run_id: UUID) -> dict[str, object] | None:
    job = await JobRepository(session).find_for_criticality(run_id)
    if job is None:
        return None
    payload = job.payload if isinstance(job.payload, dict) else {}
    return {
        "job_id": job.id,
        "run_id": run_id,
        "status": job.status,
        "progress": float(payload.get("progress", 0.0)),
        "result": payload.get("result"),
        "error": job.error,
    }


async def cancel_criticality(session: AsyncSession, run_id: UUID) -> dict[str, object] | None:
    job = await JobRepository(session).find_for_criticality(run_id)
    if job is None:
        return None
    if job.status in {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}:
        return await get_criticality_status(session, run_id)
    job.status = RunStatus.CANCELLED
    _CANCELLED_JOBS.add(run_id)
    job.finished_at = datetime.now(UTC)
    job.payload = {**(job.payload or {}), "progress": 1.0}
    await session.commit()
    return await get_criticality_status(session, run_id)
