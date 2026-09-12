"""Перевод результата ядра в строки Postgres.

Ядро отдаёт свои датаклассы (`orbita_core.metrics`), а в базе лежат таблицы
`06_STORAGE.md` §3. Перевод собран здесь, чтобы задача воркера читалась как
последовательность шагов, а не как сборка строк.
"""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from orbita_api.db import models
from orbita_api.schemas.common import OutageCause
from orbita_core.diagnosis import OutageCause as CoreOutageCause
from orbita_core.metrics import AggregateResult
from orbita_core.metrics import ClientMetrics as CoreClientMetrics
from orbita_core.metrics import ConfigMetrics as CoreConfigMetrics
from orbita_core.metrics import OutageInterval as CoreOutageInterval


def client_metric_rows(run_id: UUID, aggregate: AggregateResult) -> list[models.ClientMetrics]:
    return [_client_row(run_id, client) for client in aggregate.clients]


def config_metric_row(run_id: UUID, aggregate: AggregateResult) -> models.ConfigMetrics:
    return _config_row(run_id, aggregate.config)


def outage_rows(run_id: UUID, aggregate: AggregateResult) -> list[models.OutageInterval]:
    return [_outage_row(run_id, outage) for outage in aggregate.outages]


def _client_row(run_id: UUID, client: CoreClientMetrics) -> models.ClientMetrics:
    return models.ClientMetrics(
        run_id=run_id,
        client_id=client.client_id,
        availability=client.availability,
        visibility=client.visibility,
        max_gap_s=client.max_gap_s,
        mean_hops=client.mean_hops,
        max_hops=client.max_hops,
        route_switches=client.route_switches,
        target_met=client.target_met,
        outage_count_by_cause=_causes_count(client.outage_count_by_cause),
    )


def _config_row(run_id: UUID, config: CoreConfigMetrics) -> models.ConfigMetrics:
    return models.ConfigMetrics(
        run_id=run_id,
        min_client_availability=config.min_client_availability,
        mean_client_availability=config.mean_client_availability,
        worst_max_gap_s=config.worst_max_gap_s,
        mean_hops=config.mean_hops,
        max_hops=config.max_hops,
        route_switches_total=config.route_switches_total,
        backup_path_count_min=config.backup_path_count_min,
        outage_count_by_cause=_causes_count(config.outage_count_by_cause),
        target_met_clients=list(config.target_met_clients),
    )


def _outage_row(run_id: UUID, outage: CoreOutageInterval) -> models.OutageInterval:
    """Строка перерыва: колонки — то, по чему идут выборки, остальное — доказательство.

    В `evidence` складывается всё, чем причина подтверждается на экране Outage Detective
    (ADR-005): по этим полям не фильтруют, а отдельная колонка на каждое означала бы
    миграцию при каждом новом доказательстве.
    """
    return models.OutageInterval(
        run_id=run_id,
        client_id=outage.client_id,
        start_s=outage.start_s,
        end_s=outage.end_s,
        truncated_by_horizon=outage.truncated_by_horizon,
        primary_cause=OutageCause(str(outage.primary_cause)),
        causes=[str(cause) for cause in outage.causes],
        evidence=_evidence(outage),
    )


def _evidence(outage: CoreOutageInterval) -> dict[str, Any]:
    return {
        "client_visible_satellites": list(outage.client_visible_satellites),
        "gateway_visible_satellites": list(outage.gateway_visible_satellites),
        "failed_satellites": list(outage.failed_satellites),
        "client_component_id": outage.client_component_id,
        "gateway_component_id": outage.gateway_component_id,
        # Маршрута до перерыва не существует, если перерыв начался вместе с горизонтом;
        # контракт `05_API.md` §1 ждёт список, поэтому отсутствие — пустой список.
        "last_path": list(outage.last_path or ()),
        "next_path": list(outage.next_path or ()),
    }


def _causes_count(counts: Mapping[CoreOutageCause, int]) -> dict[str, int]:
    """Ключи-перечисления в строки: в JSONB уходят имена глоссария, а не repr enum."""
    return {str(cause): count for cause, count in counts.items()}
