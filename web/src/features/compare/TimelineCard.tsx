import { useCallback, useMemo } from 'react';

import { comparisonsApi } from '@/api/comparisons';
import type { ComparisonEntry, OutageCause, RunTimeline } from '@/api/types';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { formatClock } from '@/lib/measures';
import { useResource } from '@/lib/use-resource';
import { slotColor, slotLetter } from './slots';
import { buildTracks, CAUSE_COLORS, CAUSE_TITLES } from './timeline';
import type { ClientTrack } from './timeline';

const LEFT = 26;
const TOP = 862;
const LABEL_WIDTH = 68;
const TRACK_WIDTH = 1736;
const TRACK_HEIGHT = 20;
const BAR_HEIGHT = 8;
const AXIS_TICKS = 8;

/**
 * «Окна недоступности» (узел Figma `47:526`): толстая шкала — база, тонкие полосы под ней —
 * остальные варианты на той же оси времени. Общая ось здесь и есть смысл блока: сдвиг
 * перерыва на полчаса виден только тогда, когда обе шкалы начинаются в одной точке.
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
    () => Promise.all(key.split(',').map((runId) => comparisonsApi.timeline(runId))),
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
        толстая шкала — вариант {slotLetter(0)} · тонкие полосы — остальные варианты
      </p>

      {timelines.data !== null && <Legend tracks={timelines.data} />}

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
  const tracks = useMemo(() => timelines.map(buildTracks), [timelines]);
  const baseTracks = tracks[0];

  if (base === undefined || baseTracks === undefined) {
    return null;
  }

  const horizon = base.total_ticks * base.step_s;
  const blockHeight = 34 + 12 * Math.max(1, timelines.length - 1);

  return (
    <>
      <div className="scroll-area absolute left-[31px] top-[39px] h-[136px] w-[1812px]">
        {baseTracks.map((track, clientIndex) => (
          <div key={track.clientId} style={{ height: blockHeight }} className="relative">
            <span className="absolute left-0 top-[16px] text-base font-semibold text-ink-primary">
              {track.clientId}
            </span>

            {tracks.slice(1).map((candidate, index) => {
              const line = candidate[clientIndex];
              return line === undefined ? null : (
                <CandidateBar
                  key={entries[index + 1]?.run_id ?? index}
                  track={line}
                  colorIndex={index + 1}
                  top={index * 12}
                />
              );
            })}

            <BaseTrack
              track={track}
              top={12 * Math.max(1, timelines.length - 1)}
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
            {formatClock((index * horizon) / AXIS_TICKS)}
          </span>
        ))}
      </div>
    </>
  );
}

function BaseTrack({
  track,
  top,
  horizon,
  onOpen,
}: {
  track: ClientTrack;
  top: number;
  horizon: number;
  onOpen: (seconds: number) => void;
}) {
  const cellWidth = TRACK_WIDTH / track.cells.length;

  return (
    <button
      type="button"
      aria-label={`Открыть «Сеть» на выбранном отсчёте для пункта ${track.clientId}`}
      className="absolute rounded-sm"
      style={{ left: LABEL_WIDTH, top, width: TRACK_WIDTH, height: TRACK_HEIGHT }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        // `detail === 0` — нажатие с клавиатуры: координаты курсора нет, и открывать
        // полночь вместо интересного места было бы обманом. Берётся первый перерыв.
        const share =
          event.detail === 0
            ? (track.outages[0]?.from ?? 0)
            : (event.clientX - box.left) / box.width;
        onOpen(Math.round(share * horizon));
      }}
    >
      <svg width={TRACK_WIDTH} height={TRACK_HEIGHT} aria-hidden="true">
        {track.cells.map((cell, index) => (
          <rect
            key={index}
            x={index * cellWidth}
            y={0}
            width={Math.max(cellWidth - 0.6, 0.6)}
            height={TRACK_HEIGHT}
            style={{
              fill: cell.cause === null ? 'var(--chart-ok)' : CAUSE_COLORS[cell.cause],
            }}
          />
        ))}
      </svg>
    </button>
  );
}

function CandidateBar({
  track,
  colorIndex,
  top,
}: {
  track: ClientTrack;
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
      {track.outages.map((outage) => (
        <rect
          key={outage.from}
          x={outage.from * TRACK_WIDTH}
          y={0}
          width={Math.max((outage.to - outage.from) * TRACK_WIDTH, 1)}
          height={BAR_HEIGHT}
          style={{ fill: 'var(--chart-no-sat)' }}
        />
      ))}
    </svg>
  );
}

/** В легенде только те причины, которые встретились на шкалах: словарь целиком не нужен. */
function Legend({ tracks }: { tracks: readonly RunTimeline[] }) {
  const causes = useMemo(() => {
    const found = new Set<OutageCause>();
    for (const timeline of tracks) {
      for (const client of timeline.clients) {
        for (const cause of client.causes) {
          if (cause !== null) {
            found.add(cause);
          }
        }
      }
    }
    return [...found];
  }, [tracks]);

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
            style={{ background: CAUSE_COLORS[cause] }}
          />
          {CAUSE_TITLES[cause]}
        </span>
      ))}
    </div>
  );
}
