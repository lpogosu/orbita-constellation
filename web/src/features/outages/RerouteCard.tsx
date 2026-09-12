import { ArrowRight } from 'lucide-react';

import type { ClientComparison, ClientMetrics, ClientRoute } from '@/api/types';
import { EmptyState, Skeleton } from '@/components/state/States';
import { CAUSE_LABEL } from '@/map/palette';
import { formatClock } from '@/timeline/segments';
import { formatPoints } from './format';

interface RerouteCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly clientId: string | null;
  readonly comparison: ClientComparison | null;
  readonly beforeRoute: ClientRoute | null;
  readonly afterRoute: ClientRoute | null;
  readonly beforeMetrics: ClientMetrics | null;
  readonly afterMetrics: ClientMetrics | null;
  readonly loading: boolean;
}

/** Карточка «что стало с клиентом» (`14_SCREENS.md` §3.3), узел макета `43:407`. */
export function RerouteCard(props: RerouteCardProps) {
  const added = props.comparison?.outage_diff.find((change) => change.kind === 'added');
  const title = describeStatus(props.comparison);

  return (
    <div
      className="card-glass absolute px-[20px] pb-[16px] pt-[12px]"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        backgroundPosition: `0 0, ${-props.x}px ${-props.y}px`,
      }}
    >
      {props.clientId === null ? (
        <EmptyState
          title="Клиент не выбран"
          hint="Выберите клиента в списке слева или на карте — здесь появится его маршрут до и после отказа."
        />
      ) : props.loading ? (
        <Skeleton className="h-full w-full" />
      ) : (
        <>
          <p className="font-display text-[38px] font-bold leading-none tracking-[-0.5px] text-ink-primary">
            {props.clientId}
          </p>
          <p className="mt-[8px] flex items-center gap-[10px] text-heading-m font-bold text-ink-primary">
            <span
              aria-hidden="true"
              className="size-[14px] rounded-pill"
              style={{ background: added === undefined ? 'var(--chart-ok)' : 'var(--chart-no-client)' }}
            />
            {title}
          </p>

          <div className="mt-[14px] grid grid-cols-[1fr_auto_1fr] items-center gap-[12px]">
            <RouteBox
              caption="До"
              route={props.beforeRoute}
              metrics={props.beforeMetrics}
              tone="text-ink-secondary"
            />
            <ArrowRight aria-hidden="true" className="size-[26px] text-ink-muted" />
            <RouteBox
              caption="После"
              route={props.afterRoute}
              metrics={props.afterMetrics}
              tone={added === undefined ? 'text-status-success' : 'text-status-warning'}
            />
          </div>

          <div aria-hidden="true" className="mt-[16px] h-px bg-line-divider" />

          <dl className="mt-[12px] space-y-[8px]">
            <div className="flex items-baseline gap-[16px]">
              <dt className="w-[150px] text-body text-ink-secondary">Причина</dt>
              <dd className="text-title-m font-semibold text-ink-primary">
                {added === undefined
                  ? 'Перерывов не добавилось'
                  : `${CAUSE_LABEL[added.primary_cause]}${
                      added.failed_satellites.length > 0
                        ? ` · ${added.failed_satellites.join(', ')}`
                        : ''
                    }`}
              </dd>
            </div>
            <div className="flex items-baseline gap-[16px]">
              <dt className="w-[150px] text-body text-ink-secondary">Влияние</dt>
              <dd
                className={
                  (props.comparison?.availability_delta ?? 0) < 0
                    ? 'text-title-m font-semibold text-status-danger'
                    : 'text-title-m font-semibold text-status-success'
                }
                data-numeric
              >
                {props.comparison === null ? '—' : formatPoints(props.comparison.availability_delta)}
              </dd>
            </div>
            {added !== undefined && (
              <div className="flex items-baseline gap-[16px]">
                <dt className="w-[150px] text-body text-ink-secondary">Новый перерыв</dt>
                <dd className="text-title-m font-semibold text-ink-primary" data-numeric>
                  {formatClock(added.other_start_s ?? 0)} – {formatClock(added.other_end_s ?? 0)}
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
}

function RouteBox({
  caption,
  route,
  metrics,
  tone,
}: {
  caption: string;
  route: ClientRoute | null;
  metrics: ClientMetrics | null;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-line-subtle bg-surface-sunken px-[15px] py-[11px]">
      <p className={`text-base font-medium ${tone}`}>{caption}</p>
      <p className="mt-[8px] break-words text-caption text-ink-primary">
        {route === null ? '—' : route.path.length === 0 ? 'маршрута нет' : route.path.join(' → ')}
      </p>
      <p className="mt-[8px] text-micro text-ink-muted" data-numeric>
        {route?.hops ?? '—'} переходов
        {metrics !== null && ` · ${(metrics.availability * 100).toFixed(2)} %`}
      </p>
    </div>
  );
}

function describeStatus(comparison: ClientComparison | null): string {
  if (comparison === null) {
    return 'Сравнение не построено';
  }
  if (comparison.outage_diff.some((change) => change.kind === 'added')) {
    return 'Появился перерыв';
  }
  return comparison.affected ? 'Маршрут перестроен' : 'Маршрут не изменился';
}
