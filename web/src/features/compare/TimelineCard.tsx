import { useCallback, useMemo } from 'react';

import { getRunTimeline } from '@/api/runs';
import type { ComparisonEntry, OutageCause, RunTimeline } from '@/api/types';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { useViewport } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
// Разбор битовых масок и склейка отрезков едины со шкалой экрана «Результат»: два
// декодера одного `availability_bitset` рано или поздно разойдутся в краевом отсчёте.
import { segmentsOf } from '@/features/result/timeline';
import type { TimelineSegment } from '@/features/result/timeline';
import { causeView, formatTick, variantLetter } from '@/lib/run-format';
import { useResource } from '@/lib/use-resource';
import { slotColor } from './slots';

const LEFT = 26;
const TOP = 862;
const LABEL_WIDTH = 68;
const TRACK_WIDTH = 1736;
const TRACK_HEIGHT = 20;
const BAR_HEIGHT = 8;
const AXIS_TICKS = 8;
const BLOCK_BASE_HEIGHT = 34;
const BAR_PITCH = 12;
/** Высота области шкал на полотне (`h-[136px]` ниже) и самый плотный допустимый шаг полос. */
const CANVAS_ROWS_HEIGHT = 136;
const MIN_BAR_PITCH = 10;
/** Поле карточки в потоке и её рамка: ширина шкал считается от колонки за их вычетом. */
const STACKED_PADDING = 16;
const CARD_BORDERS = 2;
/**
 * Уже этой ширины отрезок в пять минут на сутках превращается в пиксель: шкала
 * прокручивается вбок внутри карточки, а не ужимается до неразличимой.
 */
const STACKED_MIN_TRACK_WIDTH = 520;

/**
 * «Окна недоступности» (узел Figma `47:526`): толстая шкала — база, тонкие полосы над ней —
 * остальные варианты на той же оси времени. Общая ось и есть смысл блока: сдвиг перерыва
 * на полчаса виден только тогда, когда обе шкалы начинаются в одной точке.
 */
export function TimelineCard({
  entries,
  onOpenTick,
}: {
  entries: readonly ComparisonEntry[];
  onOpenTick: (variantId: string, seconds: number) => void;
}) {
  const key = entries.map((entry) => entry.run_id).join(',');

  const load = useCallback(
    () => Promise.all(key.split(',').map((runId) => getRunTimeline(runId))),
    [key],
  );
  const timelines = useResource<RunTimeline[]>(load);
  const { mode, contentWidth } = useViewport();
  const stacked = mode === 'stacked';
  const trackWidth = stacked
    ? Math.max(contentWidth - STACKED_PADDING * 2 - CARD_BORDERS - LABEL_WIDTH, STACKED_MIN_TRACK_WIDTH)
    : TRACK_WIDTH;

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={stacked ? 'order-5 md:col-span-2' : 'absolute h-[206px] w-[1868px]'}
      style={stacked ? { padding: STACKED_PADDING } : { left: LEFT, top: TOP }}
    >
      <h2
        className={cx(
          'font-semibold text-ink-primary',
          stacked ? 'text-title-m' : 'absolute left-[31px] top-[11px] text-title-l',
        )}
      >
        Окна недоступности
      </h2>
      <p className={cx('text-caption text-ink-muted', stacked ? 'mt-[4px]' : 'absolute left-[300px] top-[17px]')}>
        толстая шкала — вариант {variantLetter(0)} · тонкие полосы — остальные варианты
      </p>

      {timelines.data !== null && <Legend timelines={timelines.data} stacked={stacked} />}

      {timelines.error !== null && (
        <div className={stacked ? 'mt-[12px] h-[96px]' : 'absolute inset-x-[31px] top-[46px] h-[150px]'}>
          <ErrorBlock
            title="Шкалы не загрузились"
            message={timelines.error}
            onRetry={timelines.reload}
            compact
          />
        </div>
      )}

      {timelines.data === null && timelines.error === null && (
        <LoadingBlock label="Загрузка шкал недоступности">
          <div className={stacked ? 'mt-[12px] space-y-[20px]' : 'absolute inset-x-[31px] top-[55px] space-y-[20px]'}>
            <Skeleton className="h-[26px] w-full" />
            <Skeleton className="h-[26px] w-full" />
            <Skeleton className="h-[26px] w-full" />
          </div>
        </LoadingBlock>
      )}

      {timelines.data !== null && (
        <Tracks
          timelines={timelines.data}
          entries={entries}
          onOpenTick={onOpenTick}
          stacked={stacked}
          trackWidth={trackWidth}
        />
      )}
    </Card>
  );
}

function Tracks({
  timelines,
  entries,
  onOpenTick,
  stacked,
  trackWidth,
}: {
  timelines: readonly RunTimeline[];
  entries: readonly ComparisonEntry[];
  onOpenTick: (variantId: string, seconds: number) => void;
  stacked: boolean;
  trackWidth: number;
}) {
  const base = timelines[0];

  const tracks = useMemo(
    () =>
      timelines.map((timeline) =>
        timeline.clients.map((client) => ({
          clientId: client.client_id,
          segments: segmentsOf(client, timeline.total_ticks),
          totalTicks: timeline.total_ticks,
        })),
      ),
    [timelines],
  );
  const baseTracks = tracks[0];

  if (base === undefined || baseTracks === undefined) {
    return null;
  }

  const horizon = base.total_ticks * base.step_s;
  const candidates = Math.max(1, timelines.length - 1);
  // Макет рассчитан на два варианта: с третьим блоки клиентов переставали помещаться в
  // область, и последний клиент уходил под обрез карточки. На полотне шаг тонких полос
  // сжимается под фактическое число клиентов; прокрутка остаётся запасом, когда вариантов
  // так много, что сжать уже нельзя.
  const fittedPitch = Math.floor(
    (CANVAS_ROWS_HEIGHT / Math.max(1, baseTracks.length) - (BLOCK_BASE_HEIGHT - BAR_PITCH)) / candidates,
  );
  const pitch = stacked ? BAR_PITCH : Math.max(MIN_BAR_PITCH, Math.min(BAR_PITCH, fittedPitch));
  const blockHeight = BLOCK_BASE_HEIGHT - BAR_PITCH + pitch * candidates;

  const rows = (
    <>
      <div className={stacked ? 'mt-[12px]' : 'scroll-area absolute left-[31px] top-[39px] h-[136px] w-[1812px]'}>
        {baseTracks.map((track, clientIndex) => (
          <div key={track.clientId} style={{ height: blockHeight }} className="relative">
            <span
              className="absolute left-0 text-base font-semibold text-ink-primary"
              style={{ top: pitch * candidates + 4 }}
            >
              {track.clientId}
            </span>

            {tracks.slice(1).map((candidate, index) => {
              const line = candidate[clientIndex];
              return line === undefined ? null : (
                <CandidateBar
                  key={entries[index + 1]?.run_id ?? index}
                  segments={line.segments}
                  totalTicks={line.totalTicks}
                  colorIndex={index + 1}
                  top={index * pitch}
                  width={trackWidth}
                />
              );
            })}

            <BaseTrack
              segments={track.segments}
              totalTicks={track.totalTicks}
              clientId={track.clientId}
              top={pitch * candidates}
              width={trackWidth}
              horizon={horizon}
              onOpen={(seconds) => {
                const variantId = entries[0]?.variant_id;
                if (variantId !== undefined) {
                  onOpenTick(variantId, seconds);
                }
              }}
            />
          </div>
        ))}
      </div>

      <div
        className={stacked ? 'relative h-[24px]' : 'absolute left-[31px] top-[179px] h-[24px] w-[1806px]'}
      >
        {Array.from({ length: AXIS_TICKS + 1 }, (_, index) => (
          <span
            key={index}
            className={cx(
              'absolute text-ink-muted',
              stacked ? 'text-caption' : 'text-small',
              // Крайние подписи в потоке прижаты внутрь: отцентрованные, они выходили бы за
              // край прокручиваемой области.
              stacked && index === AXIS_TICKS ? '-translate-x-full' : '-translate-x-1/2',
            )}
            style={{ left: LABEL_WIDTH + (index * trackWidth) / AXIS_TICKS }}
            data-numeric
          >
            {formatTick((index * horizon) / AXIS_TICKS)}
          </span>
        ))}
      </div>
    </>
  );

  if (!stacked) {
    return rows;
  }

  // Шкалы и ось прокручиваются вместе: по отдельности подписи времени уезжали бы от полос.
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]">
      <div style={{ width: LABEL_WIDTH + trackWidth }}>{rows}</div>
    </div>
  );
}

function BaseTrack({
  segments,
  totalTicks,
  clientId,
  top,
  width,
  horizon,
  onOpen,
}: {
  segments: readonly TimelineSegment[];
  totalTicks: number;
  clientId: string;
  top: number;
  width: number;
  horizon: number;
  onOpen: (seconds: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Открыть «Сеть» на выбранном отсчёте для пункта ${clientId}`}
      className="absolute overflow-hidden rounded-[3px]"
      style={{ left: LABEL_WIDTH, top, width, height: TRACK_HEIGHT }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        // `detail === 0` — нажатие с клавиатуры: позиции курсора нет, и открывать полночь
        // вместо интересного места было бы обманом. Берётся первый перерыв.
        const share =
          event.detail === 0
            ? firstOutageShare(segments, totalTicks)
            : (event.clientX - box.left) / box.width;
        onOpen(Math.round(share * horizon));
      }}
    >
      <svg width={width} height={TRACK_HEIGHT} aria-hidden="true">
        {segments.map((segment) => (
          <rect
            key={segment.from}
            x={(segment.from / totalTicks) * width}
            y={0}
            width={Math.max(((segment.to - segment.from) / totalTicks) * width, 1)}
            height={TRACK_HEIGHT}
            style={{
              fill: segment.cause === null ? 'var(--chart-ok)' : causeView(segment.cause).color,
            }}
          />
        ))}
      </svg>
    </button>
  );
}

function CandidateBar({
  segments,
  totalTicks,
  colorIndex,
  top,
  width,
}: {
  segments: readonly TimelineSegment[];
  totalTicks: number;
  colorIndex: number;
  top: number;
  width: number;
}) {
  return (
    <svg
      className="absolute"
      style={{ left: LABEL_WIDTH, top }}
      width={width}
      height={BAR_HEIGHT}
      aria-hidden="true"
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={BAR_HEIGHT}
        rx={BAR_HEIGHT / 2}
        opacity={0.6}
        style={{ fill: slotColor(colorIndex) }}
      />
      {segments
        .filter((segment) => segment.cause !== null)
        .map((segment) => (
          <rect
            key={segment.from}
            x={(segment.from / totalTicks) * width}
            y={0}
            width={Math.max(((segment.to - segment.from) / totalTicks) * width, 1)}
            height={BAR_HEIGHT}
            style={{ fill: 'var(--chart-no-sat)' }}
          />
        ))}
    </svg>
  );
}

/** В легенде только те причины, которые встретились на шкалах: словарь целиком не нужен. */
function Legend({ timelines, stacked }: { timelines: readonly RunTimeline[]; stacked: boolean }) {
  const causes = useMemo(() => {
    const found = new Set<OutageCause>();
    for (const timeline of timelines) {
      for (const client of timeline.clients) {
        for (const cause of client.causes) {
          if (cause !== null) {
            found.add(cause);
          }
        }
      }
    }
    return [...found];
  }, [timelines]);

  return (
    /* Короткие названия причин и перенос: полные пять названий доходили до подписи слева. */
    <div
      className={cx(
        'flex flex-wrap items-center gap-x-[22px] gap-y-[4px]',
        stacked ? 'mt-[8px]' : 'absolute right-[31px] top-[13px] max-w-[1100px] justify-end',
      )}
    >
      <span className="flex items-center gap-[10px] whitespace-nowrap text-small text-ink-secondary">
        <span
          aria-hidden="true"
          className="size-[14px] shrink-0 rounded-full"
          style={{ background: 'var(--chart-ok)' }}
        />
        Связь доступна
      </span>
      {causes.map((cause) => (
        <span
          key={cause}
          title={causeView(cause).full}
          className="flex items-center gap-[10px] whitespace-nowrap text-small text-ink-secondary"
        >
          <span
            aria-hidden="true"
            className="size-[14px] shrink-0 rounded-full"
            style={{ background: causeView(cause).color }}
          />
          {causeView(cause).short}
        </span>
      ))}
    </div>
  );
}

function firstOutageShare(segments: readonly TimelineSegment[], totalTicks: number): number {
  const outage = segments.find((segment) => segment.cause !== null);
  return outage === undefined ? 0 : outage.from / totalTicks;
}
