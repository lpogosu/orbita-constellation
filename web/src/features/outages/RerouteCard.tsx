import { ArrowRight } from 'lucide-react';

import type { ClientComparison, ClientMetrics, ClientRoute } from '@/api/types';
import { EmptyState, Skeleton } from '@/components/state/States';
import { causeView, formatTick } from '@/lib/run-format';
import { formatPoints } from './format';
import { useCardBox } from '@/components/layout/box';
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import { withTextGrowth } from '@/styles/readable-text';

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

  const box = useCardBox(props);
  const stacked = useStacked();
  const labelStyle = stacked ? undefined : CANVAS_LABEL_STYLE;

  return (
    <div
      className={`card-glass ${box.positionClass} flex flex-col px-[20px] pb-[16px] pt-[12px]`}
      style={box.style}
    >
      {props.clientId === null ? (
        // В потоке у карточки нет макетной высоты: пустому состоянию нужна своя.
        <div className={stacked ? 'h-[220px]' : 'h-full'}>
          <EmptyState
          title="Клиент не выбран"
            hint="Выберите клиента в списке затронутых или на карте — здесь появится его маршрут до и после отказа."
          />
        </div>
      ) : props.loading ? (
        <Skeleton className={cx('w-full', stacked ? 'h-[260px]' : 'h-full')} />
      ) : (
        <>
          <p
            title={props.clientId}
            className={cx(
              'truncate font-display font-bold leading-none tracking-[-0.5px] text-ink-primary',
              stacked ? 'text-heading-m' : 'text-[38px]',
            )}
          >
            {props.clientId}
          </p>
          <p
            className={cx(
              'mt-[8px] flex items-center gap-[10px] truncate font-bold text-ink-primary',
              stacked ? 'text-title-l' : 'text-heading-m',
            )}
          >
            {/* Точка статуса: переменной `--chart-no-client` в токенах нет, и с ней точка
                «Появился перерыв» была прозрачной. Цвет перерыва — тот же, что на шкале; пока
                сравнения нет, точка нейтральная, а не зелёная «всё хорошо». */}
            <span
              aria-hidden="true"
              className="size-[14px] shrink-0 rounded-pill"
              style={{
                background:
                  props.comparison === null
                    ? 'var(--status-neutral)'
                    : added === undefined
                      ? 'var(--chart-ok)'
                      : 'var(--chart-no-sat)',
              }}
            />
            <span className="truncate">{title}</span>
          </p>

          <div
            className={cx(
              'mt-[14px] grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center',
              stacked ? 'gap-[8px]' : 'gap-[12px]',
            )}
          >
            <RouteBox
              caption="До"
              route={props.beforeRoute}
              metrics={props.beforeMetrics}
              tone="text-ink-secondary"
            />
            <ArrowRight aria-hidden="true" className={cx('text-ink-muted', stacked ? 'size-[20px]' : 'size-[26px]')} />
            <RouteBox
              caption="После"
              route={props.afterRoute}
              metrics={props.afterMetrics}
              tone={added === undefined ? 'text-status-success' : 'text-status-warning'}
            />
          </div>

          <div aria-hidden="true" className="mt-[12px] h-px shrink-0 bg-line-divider" />

          {/* Подписи и значения на ступень мельче макетных, а влияние и новый перерыв на
              полотне стоят в одной строке: три крупные строки в 316 пикселей карточки не
              помещались, и влияние уходило под край без намёка на прокрутку. Прокрутка осталась
              страховкой для длинного списка отказавших аппаратов. */}
          <dl className={cx('mt-[10px] space-y-[6px]', !stacked && 'scroll-area min-h-0 flex-1 pr-[6px]')}>
            <div className="flex items-baseline gap-[16px]">
              <dt className={labelClass} style={labelStyle}>Причина</dt>
              <dd className="min-w-0 flex-1 text-base font-semibold text-ink-primary">
                {added === undefined
                  ? 'Перерывов не добавилось'
                  : `${causeView(added.primary_cause).full}${
                      added.failed_satellites.length > 0
                        ? ` · ${added.failed_satellites.join(', ')}`
                        : ''
                    }`}
              </dd>
            </div>
            <div className={cx('flex', stacked ? 'flex-col gap-[6px]' : 'items-baseline gap-[24px]')}>
              <div className="flex items-baseline gap-[16px]">
                <dt className={labelClass} style={labelStyle}>Влияние</dt>
                <dd
                  className={cx(
                    'whitespace-nowrap text-base font-semibold',
                    props.comparison === null
                      ? 'text-ink-muted'
                      : props.comparison.availability_delta < 0
                        ? 'text-status-danger'
                        : 'text-status-success',
                  )}
                  data-numeric
                >
                  {props.comparison === null ? '—' : formatPoints(props.comparison.availability_delta)}
                </dd>
              </div>
              {added !== undefined && (
                <div className="flex items-baseline gap-[10px]">
                  <dt className={stacked ? labelClass : 'shrink-0 text-small text-ink-secondary'}>
                    {stacked ? 'Новый перерыв' : 'Перерыв'}
                  </dt>
                  <dd className="whitespace-nowrap text-base font-semibold text-ink-primary" data-numeric>
                    {formatTick(added.other_start_s ?? 0)} – {formatTick(added.other_end_s ?? 0)}
                  </dd>
                </div>
              )}
            </div>
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
  // На полотне путь — одна строка с подсказкой: вторая строка сдвигала причину под край
  // карточки. В потоке высоты хватает, а колонка узкая, поэтому путь переносится.
  const stacked = useStacked();
  const hops = `${route?.hops ?? '—'} переходов`;
  const availability = metrics === null ? '' : ` · ${(metrics.availability * 100).toFixed(2)}\u00a0%`;
  return (
    <div className="min-w-0 rounded-lg border border-line-subtle bg-surface-sunken px-[15px] py-[11px]">
      <p className={`text-base font-medium ${tone}`}>{caption}</p>
      <p
        title={route === null ? undefined : route.path.join(' → ')}
        className={cx(
          'mt-[8px] text-caption text-ink-primary',
          stacked ? 'line-clamp-2 break-words' : 'truncate',
        )}
      >
        {route === null ? '—' : route.path.length === 0 ? 'маршрута нет' : route.path.join(' → ')}
      </p>
      {stacked ? (
        <p className="mt-[8px] text-micro text-ink-muted" data-numeric>
          {hops}
          {availability}
        </p>
      ) : (
        // На полотне — одна строка при любом кегле: подросшая на ноутбуке подпись
        // переносилась, коробка маршрута становилась выше, и влияние отказа уходило под край
        // карточки. Место уступает счётчик переходов, а доступность — ради неё сравнивают
        // «до» и «после» — остаётся целиком. `whitespace-pre` хранит пробел на стыке частей.
        <p className="mt-[8px] flex whitespace-pre text-micro text-ink-muted" data-numeric>
          <span className="min-w-0 truncate" title={hops}>
            {hops}
          </span>
          <span className="shrink-0">{availability}</span>
        </p>
      )}
    </div>
  );
}

const labelClass = 'w-[118px] shrink-0 text-small text-ink-secondary';
/**
 * На полотне колонка подписей отдаёт запас значениям: на 1280×720 подросшая строка
 * «Влияние · Перерыв» выходила за правый край карточки, а подписи в 118 пикселях
 * занимают едва половину ширины.
 */
const CANVAS_LABEL_STYLE = { width: withTextGrowth(118, -40) };

function describeStatus(comparison: ClientComparison | null): string {
  if (comparison === null) {
    return 'Сравнение не построено';
  }
  if (comparison.outage_diff.some((change) => change.kind === 'added')) {
    return 'Появился перерыв';
  }
  return comparison.affected ? 'Маршрут перестроен' : 'Маршрут не изменился';
}
