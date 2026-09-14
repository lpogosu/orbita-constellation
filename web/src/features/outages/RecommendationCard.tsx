import { Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ClientComparison, ComparisonEntry } from '@/api/types';
import { causeView, formatTick } from '@/lib/run-format';
import { formatPoints } from './format';
import { useCardBox } from '@/components/layout/box';
import { EmptyState, ErrorBlock, Skeleton } from '@/components/state/States';
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';

interface RecommendationCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly entry: ComparisonEntry | null;
  readonly baseTitle: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

/**
 * «Рекомендация» (`14_SCREENS.md` §3.3), узел макета `43:461`.
 *
 * Текст собирается только из полей сравнения: клиент, дельта доступности, границы нового
 * перерыва, доля отсчётов с уцелевшим маршрутом. Общих фраз здесь нет: пока сравнения нет,
 * карточка объясняет, откуда вывод возьмётся, а не оставляет пустое место в колонке.
 */
export function RecommendationCard(props: RecommendationCardProps) {
  const box = useCardBox(props);
  const stacked = useStacked();

  const entry = props.entry;
  const worst =
    entry === null
      ? undefined
      : [...entry.per_client]
          .filter((item) => item.affected)
          .sort((a, b) => a.availability_delta - b.availability_delta)[0];

  let body: ReactNode;
  if (props.error !== null) {
    body = (
      <ErrorBlock title="Сравнение не получено" message={props.error} onRetry={props.onRetry} compact />
    );
  } else if (props.loading) {
    body = (
      <div className="space-y-[8px] pt-[4px]">
        <Skeleton className="h-[14px] w-full" />
        <Skeleton className="h-[14px] w-[85%]" />
        <Skeleton className="h-[14px] w-[60%]" />
      </div>
    );
  } else if (entry === null) {
    body = (
      <EmptyState
        title="Вывода пока нет"
        hint="Задайте отказ и нажмите «Применить отказ» — вывод соберётся из сравнения с базой."
        compact
      />
    );
  } else if (worst === undefined) {
    body = (
      <EmptyState
        title="Клиенты не затронуты"
        hint="Отказ не изменил ни одного маршрута: доступность осталась как в базе."
        compact
      />
    );
  } else {
    body = (
      // Вывод собирается из полей сравнения и длины не имеет: на полотне он прокручивается
      // внутри карточки, а не обрезается её краем. Высота прокрутки кратна строке: на
      // ноутбуке кегль вывода подрастает, и последняя видимая строка резалась пополам.
      <p
        className={cx('text-small text-ink-secondary', !stacked && 'scroll-area pr-[6px]')}
        style={stacked ? undefined : { height: 'round(nearest, 100%, 1lh)' }}
      >
        {sentence(worst, entry)}
      </p>
    );
  }

  const footer =
    entry === null
      ? null
      : `основано на сравнении ${entry.run_id.slice(0, 8)}${
          props.baseTitle === null ? '' : ` с «${props.baseTitle}»`
        } · политика ${entry.routing_policy}`;

  return (
    <div
      className={`card-glass ${box.positionClass} flex flex-col px-[20px] pb-[14px] pt-[11px]`}
      style={box.style}
    >
      <p className="flex shrink-0 items-center gap-[12px] text-title-m font-semibold text-ink-primary">
        <Lightbulb aria-hidden="true" className="size-[26px] shrink-0 text-status-warning" />
        Что показало сравнение
      </p>

      {/* Отступы подобраны под четыре строки вывода в 160 пикселях карточки: при прежних
          строка обрезалась посередине. */}
      <div className={cx('mt-[8px]', stacked ? 'min-h-[64px]' : 'min-h-0 flex-1')}>
        {body}
      </div>

      {footer !== null && worst !== undefined && (
        <p title={footer} className="mt-[6px] shrink-0 truncate text-micro text-ink-muted">
          {footer}
        </p>
      )}
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
