"""Resilience X-Ray service.

The expensive counterfactual calculation lives in :mod:`orbita_core.resilience`; this
module only resolves a finished run and translates the immutable core report to the HTTP
contract.  ``to_thread`` keeps the FastAPI event loop responsive while preserving the
existing synchronous POST contract used by the web client.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from orbita_core import resilience
from sqlalchemy.ext.asyncio import AsyncSession

from orbita_api.adapters.registry import StorageRegistry
from orbita_api.schemas.results import CriticalityReport, SatelliteCriticality
from orbita_api.services import results


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
    context = await results.load_context(session, storage, run_id)
    report = await asyncio.to_thread(
        resilience.criticality,
        context.scenario,
        context.policy,
    )
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
