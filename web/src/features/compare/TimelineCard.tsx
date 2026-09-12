import { useCallback, useMemo } from 'react';

import { getRunTimeline } from '@/api/runs';
import type { ComparisonEntry, OutageCause, RunTimeline } from '@/api/types';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
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

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[206px] w-[1868px]"
      style={{ left: LEFT, top: TOP }}
    >
      <h2 className="absolute left-[31px] top-[11px] text-title-l font-semibold text-ink-primary">
        Окна недоступности
      </h2>
      <p className="absolute left-[300px] top-[17px] text-caption text-ink-muted">
        толстая шкала — вариант {variantLetter(0)} · тонкие полосы — остальные варианты
      </p>

      {timelines.data !== null && <Legend timelines={timelines.data} />}

      {timelines.error !== null && (
        <div className="absolute inset-x-[31px] top-[46px] h-[150px]">
          <ErrorBlock
            title="Шкалы не загрузились"
            message={timelines.error}
            onRetry={timelines.reload}
          />
        </div>
      )}

      {timelines.data === null && timelines.error === null && (
        <LoadingBlock label="Загрузка шкал недоступности">
          <div className="absolute inset-x-[31px] top-[55px] space-y-[20px]">
            <Skeleton className="h-[26px] w-full" />
            <Skeleton className="h-[26px] w-full" />
            <Skeleton className="h-[26px] w-full" />
          </div>
        </LoadingBlock>
      )}

      {timelines.data !== null && (
        <Tracks timelines={timelines.data} entries={entries} onOpenTick={onOpenTick} />
      )}
    </Card>
  );
}

function Tracks({
  timelines,
  entries,
  onOpenTick,
}: {
  timelines: readonly RunTimeline[];
  entries: readonly ComparisonEntry[];
  onOpenTick: (variantId: string, seconds: number) => void;
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
  const blockHeight = BLOCK_BASE_HEIGHT + BAR_PITCH * candidates;

  return (
    <>
      <div className="scroll-area absolute left-[31px] top-[39px] h-[136px] w-[1812px]">
        {baseTracks.map((track, clientIndex) => (
          <div key={track.clientId} style={{ height: blockHeight }} className="relative">
            <span
              className="absolute left-0 text-base font-semibold text-ink-primary"
              style={{ top: BAR_PITCH * candidates + 4 }}
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
                  top={index * BAR_PITCH}
                />
              );
            })}

            <BaseTrack
              segments={track.segments}
              totalTicks={track.totalTicks}
              clientId={track.clientId}
              top={BAR_PITCH * candidates}
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

      <div className="absolute left-[31px] top-[179px] h-[24px] w-[1806px]">
        {Array.from({ length: AXIS_TICKS + 1 }, (_, index) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 text-base text-ink-muted"
            style={{ left: LABEL_WIDTH + (index * TRACK_WIDTH) / AXIS_TICKS }}
            data-numeric
          >
            {formatTick((index * horizon) / AXIS_TICKS)}
          </span>
        ))}
      </div>
    </>
  );
}

function BaseTrack({
  segments,
  totalTicks,
  clientId,
  top,
  horizon,
  onOpen,
}: {
  segments: readonly TimelineSegment[];
  totalTicks: number;
  clientId: string;
  top: number;
  horizon: number;
  onOpen: (seconds: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Открыть «Сеть» на выбранном отсчёте для пункта ${clientId}`}
      className="absolute overflow-hidden rounded-[3px]"
      style={{ left: LABEL_WIDTH, top, width: TRACK_WIDTH, height: TRACK_HEIGHT }}
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
      <svg width={TRACK_WIDTH} height={TRACK_HEIGHT} aria-hidden="true">
        {segments.map((segment) => (
          <rect
            key={segment.from}
            x={(segment.from / totalTicks) * TRACK_WIDTH}
            y={0}
            width={Math.max(((segment.to - segment.from) / totalTicks) * TRACK_WIDTH, 1)}
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
}: {
  segments: readonly TimelineSegment[];
  totalTicks: number;
  colorIndex: number;
  top: number;
}) {
  return (
    <svg
      className="absolute"
      style={{ left: LABEL_WIDTH, top }}
      width={TRACK_WIDTH}
      height={BAR_HEIGHT}
      aria-hidden="true"
    >
      <rect
        x={0}
        y={0}
        width={TRACK_WIDTH}
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
            x={(segment.from / totalTicks) * TRACK_WIDTH}
            y={0}
            width={Math.max(((segment.to - segment.from) / totalTicks) * TRACK_WIDTH, 1)}
            height={BAR_HEIGHT}
            style={{ fill: 'var(--chart-no-sat)' }}
          />
        ))}
    </svg>
  );
}

/** В легенде только те причины, которые встретились на шкалах: словарь целиком не нужен. */
function Legend({ timelines }: { timelines: readonly RunTimeline[] }) {
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
    <div className="absolute right-[31px] top-[13px] flex items-center gap-[22px]">
      <span className="flex items-center gap-[10px] text-base text-ink-secondary">
        <span
          aria-hidden="true"
          className="size-[14px] rounded-full"
          style={{ background: 'var(--chart-ok)' }}
        />
        Связь доступна
      </span>
      {causes.map((cause) => (
        <span key={cause} className="flex items-center gap-[10px] text-base text-ink-secondary">
          <span
            aria-hidden="true"
            className="size-[14px] rounded-full"
            style={{ background: causeView(cause).color }}
          />
          {causeView(cause).full}
        </span>
      ))}
    </div>
  );
}

function firstOutageShare(segments: readonly TimelineSegment[], totalTicks: number): number {
  const outage = segments.find((segment) => segment.cause !== null);
  return outage === undefined ? 0 : outage.from / totalTicks;
}
