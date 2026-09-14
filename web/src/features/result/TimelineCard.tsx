import { useMemo } from 'react';

import type { OutageCause, RunTimeline } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { causeView, formatGap, formatTick } from '@/lib/run-format';
import { segmentsOf } from './timeline';

const LEFT = 37;
const TOP = 908;

/** Дорожка клиента: подпись слева, полоса до правого края карточки (узел 50:742). */
const LABEL_WIDTH = 52;
const TRACK_LEFT = 30 + LABEL_WIDTH;
const TRACK_WIDTH = 1178;
const ROW_HEIGHT = 18;
const ROW_GAP = 6;
const VISIBLE_ROWS = 3;
const AXIS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

interface Track {
  readonly clientId: string;
  readonly segments: ReturnType<typeof segmentsOf>;
}

interface TimelineCardProps {
  timeline: RunTimeline | null;
  error: string | null;
  onRetry: () => void;
}

/**
 * Card / Timeline 24h (50:733), по дорожке на клиента. В макете дорожка одна и разбита
 * на 120 квадратов; отсчётов в расчёте 720 и больше, поэтому соседние отсчёты с одной
 * причиной склеены в отрезок — иначе сегмент уже пикселя и читается как шум.
 */
export function TimelineCard({ timeline, error, onRetry }: TimelineCardProps) {
  const stacked = useStacked();
  const tracks = useMemo(
    () =>
      timeline === null
        ? []
        : timeline.clients.map((client) => ({
            clientId: client.client_id,
            segments: segmentsOf(client, timeline.total_ticks),
          })),
    [timeline],
  );

  const causes = useMemo(() => {
    const present = new Set<OutageCause>();
    for (const track of tracks) {
      for (const segment of track.segments) {
        if (segment.cause !== null) {
          present.add(segment.cause);
        }
      }
    }
    return [...present];
  }, [tracks]);

  const legend = timeline !== null && (
    <div
      className={cx(
        'flex flex-wrap gap-x-[20px] gap-y-[4px]',
        stacked ? '' : 'absolute left-[540px] top-[16px] w-[730px] justify-end',
      )}
    >
      <LegendItem color="var(--chart-ok)" label="Связь доступна" />
      {causes.map((cause) => (
        <LegendItem key={cause} color={causeView(cause).color} label={causeView(cause).short} />
      ))}
    </div>
  );

  const trackLine = (track: Track, totalTicks: number, stepS: number) => (
    <div
      className="absolute top-0 h-full overflow-hidden rounded-[3px] bg-chart-empty"
      style={stacked ? { left: LABEL_WIDTH, right: 0 } : { left: LABEL_WIDTH, width: TRACK_WIDTH }}
      role="img"
      aria-label={`Доступность клиента ${track.clientId} по суткам`}
    >
      {track.segments.map((segment) => (
        <span
          key={segment.from}
          className="absolute top-0 h-full"
          style={{
            left: `${((segment.from / totalTicks) * 100).toFixed(4)}%`,
            width: `${(((segment.to - segment.from) / totalTicks) * 100).toFixed(4)}%`,
            backgroundColor:
              segment.cause === null ? 'var(--chart-ok)' : causeView(segment.cause).color,
          }}
          title={`${track.clientId} · ${formatTick(segment.from * stepS)}–${formatTick(segment.to * stepS)} · ${formatGap((segment.to - segment.from) * stepS)} · ${
            segment.cause === null ? 'связь доступна' : causeView(segment.cause).full
          }`}
        />
      ))}
    </div>
  );

  const body = (
    <>
      {/* На полотне полоса ниже 70 пикселей: состояние идёт строкой, иначе кнопка повтора
          оказывается за нижним краем карточки. В потоке высота не ограничена. */}
      {error !== null && (
        <ErrorBlock title="Шкала не загрузилась" message={error} onRetry={onRetry} compact={!stacked} />
      )}

      {error === null && timeline === null && (
        <LoadingBlock label="Загружаем шкалу доступности">
          <ul className="space-y-[6px]">
            {[0, 1, 2].map((index) => (
              <li key={index}>
                <Skeleton className={cx('h-[18px] rounded-[2px]', stacked ? 'w-full' : 'w-[1230px]')} />
              </li>
            ))}
          </ul>
        </LoadingBlock>
      )}

      {error === null && timeline !== null && tracks.length === 0 && (
        <EmptyState
          title="Шкала пуста"
          hint="Расчёт не вернул ни одного клиента: проверьте роли наземных пунктов в сценарии."
          compact={!stacked}
        />
      )}

      {error === null && timeline !== null && tracks.length > 0 && (
        <ul className={cx('space-y-[6px]', !stacked && 'scroll-area h-full w-[1236px]')}>
          {tracks.map((track) => (
            <li key={track.clientId} className="relative" style={{ height: ROW_HEIGHT }}>
              <span
                title={track.clientId}
                className="absolute left-0 top-0 truncate pr-[6px] text-[13px] font-semibold leading-[18px] text-ink-secondary"
                style={{ width: LABEL_WIDTH }}
              >
                {track.clientId}
              </span>
              {trackLine(track, timeline.total_ticks, timeline.step_s)}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (stacked) {
    // Шкала часов под сообщением об ошибке или пустой шкалой ничего не размечает.
    const showAxis = error === null && (timeline === null || tracks.length > 0);
    return (
      <Card className="flex flex-col gap-[12px] p-[20px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-[20px] gap-y-[8px]">
          <h2 className="text-title-l font-bold text-ink-primary">24 часа</h2>
          {legend}
        </div>
        <div className="min-h-[66px]">{body}</div>
        {/* В узкой шкале девять подписей налезают друг на друга: на телефоне остаются
            метки через шесть часов, промежуточные появляются, когда есть место. */}
        {showAxis && (
          <div className="relative h-[20px]" style={{ marginLeft: LABEL_WIDTH }}>
            {AXIS_HOURS.map((hour) => (
              <span
                key={hour}
                className={cx(
                  'absolute text-caption leading-[20px] text-ink-muted',
                  hour === 0 ? '' : hour === 24 ? '-translate-x-full' : '-translate-x-1/2',
                  hour % 6 !== 0 && 'hidden sm:inline',
                )}
                style={{ left: `${((hour / 24) * 100).toFixed(4)}%` }}
                data-numeric
              >
                {hour.toString().padStart(2, '0')}:00
              </span>
            ))}
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[37px] top-[908px] h-[147px] w-[1295px]"
    >
      {/* Заголовок поднят на пять пикселей против макетных 19: при высоте строки 38 он
          касался подписи первой дорожки. */}
      <h2 className="absolute left-[24px] top-[14px] text-heading-m font-bold text-ink-primary">
        24 часа
      </h2>

      {legend}

      <div
        className="absolute left-[30px] top-[56px] w-[1230px]"
        style={{ height: VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP }}
      >
        {body}
      </div>

      {/* Подписи часов — строкой 20, а не 24: при 24 цифры ложились на нижнюю рамку. */}
      <div className="absolute top-[123px] h-[20px]" style={{ left: TRACK_LEFT, width: TRACK_WIDTH }}>
        {AXIS_HOURS.map((hour) => (
          <span
            key={hour}
            className="absolute -translate-x-1/2 text-[16px] leading-[20px] text-ink-muted"
            style={{ left: `${((hour / 24) * 100).toFixed(4)}%` }}
            data-numeric
          >
            {hour.toString().padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </Card>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-[8px] text-[14px] text-ink-secondary">
      <span
        aria-hidden="true"
        className="size-[12px] rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
