import { Lightbulb } from 'lucide-react';

import type { ClientComparison, ComparisonEntry } from '@/api/types';
import { causeView, formatTick } from '@/lib/run-format';
import { formatPoints } from './format';

interface RecommendationCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly entry: ComparisonEntry | null;
  readonly baseTitle: string | null;
}

/**
 * «Рекомендация» (`14_SCREENS.md` §3.3), узел макета `43:461`.
 *
 * Текст собирается только из полей сравнения: клиент, дельта доступности, границы нового
 * перерыва, доля отсчётов с уцелевшим маршрутом. Общих фраз здесь нет; если сравнения нет
 * — блока нет тоже.
 */
export function RecommendationCard(props: RecommendationCardProps) {
  const entry = props.entry;
  if (entry === null || entry.per_client.length === 0) {
    return null;
  }

  const worst = [...entry.per_client]
    .filter((item) => item.affected)
    .sort((a, b) => a.availability_delta - b.availability_delta)[0];
  if (worst === undefined) {
    return null;
  }

  return (
    <div
      className="card-glass absolute px-[20px] pb-[14px] pt-[11px]"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        backgroundPosition: `0 0, ${-props.x}px ${-props.y}px`,
      }}
    >
      <p className="flex items-center gap-[12px] text-title-m font-semibold text-ink-primary">
        <Lightbulb aria-hidden="true" className="size-[26px] text-status-warning" />
        Что показало сравнение
      </p>

      <p className="mt-[12px] text-small text-ink-secondary">{sentence(worst, entry)}</p>

      <p className="mt-[10px] text-micro text-ink-muted">
        основано на сравнении {entry.run_id.slice(0, 8)}
        {props.baseTitle !== null && ` с «${props.baseTitle}»`} · политика {entry.routing_policy}
      </p>
    </div>
  );
}

function sentence(worst: ClientComparison, entry: ComparisonEntry): string {
  const parts: string[] = [];
  parts.push(
    `Доступность ${worst.client_id} меняется на ${formatPoints(worst.availability_delta)}`,
  );

  const added = worst.outage_diff.find((change) => change.kind === 'added');
  if (added !== undefined) {
    parts.push(
      `появляется перерыв ${formatTick(added.other_start_s ?? 0)}–${formatTick(added.other_end_s ?? 0)} (${causeView(added.primary_cause).full}${
        added.failed_satellites.length > 0 ? `, аппараты ${added.failed_satellites.join(', ')}` : ''
      })`,
    );
  }

  const total = worst.route_kept_ticks + worst.route_rebuilt_ticks;
  if (total > 0) {
    parts.push(`маршрут совпадает узел в узел на ${worst.route_kept_ticks} отсчётах из ${total}`);
  }

  if (entry.affected_clients.length > 1) {
    parts.push(`затронуто пунктов: ${entry.affected_clients.length}`);
  }

  const gap = entry.deltas['worst_max_gap_s'];
  if (gap !== undefined && gap !== 0) {
    parts.push(`худший перерыв по конфигурации меняется на ${Math.round(gap / 60)} мин`);
  }

  return `${parts.join('; ')}.`;
}
