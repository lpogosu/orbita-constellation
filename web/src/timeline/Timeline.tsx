import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { OutageCause } from '@/api/types';
import { CAUSE_LABEL, CAUSE_ORDER, CAUSE_VARIABLE } from '@/map/palette';
import { cx } from '@/lib/cx';
import { formatClock, formatSpan } from './segments';
import type { TimelineSegment } from './segments';

export interface TimelineTrack {
  readonly clientId: string;
  readonly segments: readonly TimelineSegment[];
  /** Шкала «до» для сравнения: рисуется тонкой полосой над основной (`14_SCREENS.md` §3.4). */
  readonly baseline?: readonly TimelineSegment[];
}

/** Интервал отказа или недоступности шлюза: маркер над шкалой. */
export interface TimelineMarker {
  readonly id: string;
  readonly label: string;
  readonly startS: number;
  readonly endS: number;
}

export type PlaybackSpeed = 1 | 4 | 16;

interface TimelineProps {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly totalTicks: number;
  readonly stepS: number;
  readonly tracks: readonly TimelineTrack[];
  readonly tS: number;
  readonly onSeek: (tS: number) => void;
  readonly markers?: readonly TimelineMarker[] | undefined;
  readonly selectedClientId?: string | null | undefined;
  readonly onSelectClient?: ((clientId: string) => void) | undefined;
  readonly onSelectOutage?: ((clientId: string, startS: number) => void) | undefined;
  readonly baselineLabel?: string | undefined;
  /** Доля заполнения шкалы, пока идёт расчёт (`14_SCREENS.md` §2.6). */
  readonly completedTicks?: number | null | undefined;
  /** Состояние блока вместо треков: скелетон, пусто, ошибка, недоступно. */
  readonly placeholder?: ReactNode | undefined;
}

/** Один шаг воспроизведения: при ×1 отсчёт в четверть секунды, дальше кратно скорости. */
const TICK_INTERVAL_MS = 250;

const LABEL_WIDTH = 67;
const TRACK_LEFT = 36;
const ROW_GAP = 8;

/**
 * Шкала суток: трек на клиента, маркер времени, воспроизведение и подсказки. Компонент
 * общий — им пользуются и «Сеть», и «Отказы», поэтому он ничего не знает ни про run, ни
 * про сравнение и получает уже разобранные отрезки.
 */
export function Timeline({
  width,
  height,
  title,
  totalTicks,
  stepS,
  tracks,
  tS,
  onSeek,
  markers = [],
  selectedClientId = null,
  onSelectClient,
  onSelectOutage,
  baselineLabel,
  completedTicks = null,
  placeholder,
}: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [hover, setHover] = useState<
    { clientId: string; segment: TimelineSegment; x: number; baseline: boolean } | null
  >(null);

  const trackWidth = width - TRACK_LEFT * 2 - LABEL_WIDTH;
  const horizonS = totalTicks * stepS;
  const currentTick = stepS > 0 ? Math.round(tS / stepS) : 0;

  const seekTick = useCallback(
    (tick: number) => {
      const clamped = Math.min(Math.max(tick, 0), Math.max(totalTicks - 1, 0));
      onSeek(clamped * stepS);
    },
    [onSeek, stepS, totalTicks],
  );

  // Воспроизведение останавливается на конце горизонта, а не заворачивается: иначе
  // непонятно, кончились сутки или шкала «перескочила».
  useEffect(() => {
    if (!playing || totalTicks === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      const next = currentTick + speed;
      if (next >= totalTicks) {
        setPlaying(false);
        seekTick(totalTicks - 1);
        return;
      }
      seekTick(next);
    }, TICK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing, speed, currentTick, totalTicks, seekTick]);

  useEffect(() => {
    if (totalTicks === 0) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      // Пробел и стрелки принадлежат полю ввода, пока курсор в нём.
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      switch (event.key) {
        case ' ':
          event.preventDefault();
          setPlaying((value) => !value);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seekTick(currentTick - 1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          seekTick(currentTick + 1);
          break;
        case 'Home':
          event.preventDefault();
          seekTick(0);
          break;
        case 'End':
          event.preventDefault();
          seekTick(totalTicks - 1);
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [currentTick, seekTick, totalTicks]);

  const rowsTop = 63;
  const rowHeight = tracks.length > 0
    ? Math.min(34, Math.max(22, (height - rowsTop - 46) / tracks.length))
    : 30;
  const cursorRatio = totalTicks > 1 ? currentTick / (totalTicks - 1) : 0;

  return (
    <section
      aria-label="Шкала суток"
      className="relative overflow-hidden rounded-2xl border border-line bg-surface-glass shadow-card"
      style={{ width, height }}
    >
      <h2
        className="absolute left-[36px] top-[13px] font-display text-heading-m font-bold text-ink-primary"
        data-numeric
      >
        {title}
      </h2>

      <div className="absolute left-[175px] top-[13px] flex items-center gap-[6px]">
        <TransportButton label="В начало" onClick={() => { seekTick(0); }}>
          <SkipBack aria-hidden="true" className="size-[16px]" />
        </TransportButton>
        <TransportButton label="Назад на отсчёт" onClick={() => { seekTick(currentTick - 1); }}>
          <ChevronLeft aria-hidden="true" className="size-[16px]" />
        </TransportButton>
        <button
          type="button"
          aria-label={playing ? 'Пауза' : 'Воспроизвести'}
          aria-pressed={playing}
          onClick={() => { setPlaying((value) => !value); }}
          className="flex h-[34px] w-[40px] items-center justify-center rounded-[10px] bg-accent-violet text-ink-onAccent transition-[filter] duration-150 hover:brightness-110"
        >
          {playing ? (
            <Pause aria-hidden="true" className="size-[16px]" />
          ) : (
            <Play aria-hidden="true" className="size-[16px]" />
          )}
        </button>
        <TransportButton label="Вперёд на отсчёт" onClick={() => { seekTick(currentTick + 1); }}>
          <ChevronRight aria-hidden="true" className="size-[16px]" />
        </TransportButton>
        <TransportButton label="В конец" onClick={() => { seekTick(totalTicks - 1); }}>
          <SkipForward aria-hidden="true" className="size-[16px]" />
        </TransportButton>

        <div className="ml-[6px] flex items-start gap-[2px] rounded-[10px] bg-surface-chip p-[3px]">
          {([1, 4, 16] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={speed === value}
              onClick={() => { setSpeed(value); }}
              className={cx(
                'h-[28px] w-[36px] rounded-[8px] text-caption font-semibold transition-colors duration-150',
                speed === value ? 'bg-accent-violet text-ink-onAccent' : 'text-ink-secondary',
              )}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>

      <output
        className="absolute top-[23px] flex h-[36px] w-[88px] items-center justify-center rounded-sm border border-line bg-surface-raised text-base font-medium text-ink-primary"
        style={{ left: 443 }}
        data-numeric
      >
        {formatClock(tS)}
      </output>

      <ul className="absolute right-[24px] top-[21px] flex items-center gap-[14px]">
        <CauseLegendItem color="var(--chart-ok)" label="связь есть" />
        {CAUSE_ORDER.map((cause) => (
          <CauseLegendItem key={cause} color={`var(${CAUSE_VARIABLE[cause]})`} label={CAUSE_LABEL[cause]} />
        ))}
      </ul>

      {placeholder !== undefined ? (
        <div className="absolute inset-x-0 bottom-0 top-[60px]">{placeholder}</div>
      ) : (
        <>
          {markers.length > 0 && (
            <div
              className="absolute h-[10px]"
              style={{ left: TRACK_LEFT + LABEL_WIDTH, top: rowsTop - 14, width: trackWidth }}
            >
              {markers.map((marker) => (
                <span
                  key={marker.id}
                  title={`${marker.label} · ${formatClock(marker.startS)}–${formatClock(marker.endS)}`}
                  className="absolute top-0 h-[6px] rounded-pill bg-status-danger"
                  style={{
                    left: `${(marker.startS / horizonS) * 100}%`,
                    width: `${Math.max(((marker.endS - marker.startS) / horizonS) * 100, 0.3)}%`,
                  }}
                />
              ))}
            </div>
          )}

          {tracks.map((track, index) => (
            <div
              key={track.clientId}
              className="absolute flex items-center"
              style={{
                left: TRACK_LEFT,
                top: rowsTop + index * (rowHeight + ROW_GAP),
                width: width - TRACK_LEFT * 2,
                height: rowHeight,
              }}
            >
              <button
                type="button"
                onClick={() => onSelectClient?.(track.clientId)}
                className={cx(
                  'w-[60px] shrink-0 text-left text-base font-semibold transition-colors duration-150',
                  track.clientId === selectedClientId ? 'text-ink-primary' : 'text-ink-secondary',
                )}
              >
                {track.clientId}
              </button>

              <TrackStrip
                width={trackWidth}
                height={rowHeight}
                track={track}
                totalTicks={totalTicks}
                stepS={stepS}
                onSeekTick={seekTick}
                onHover={setHover}
                onSelectOutage={onSelectOutage}
              />
            </div>
          ))}

          {completedTicks !== null && totalTicks > 0 && (
            <div
              aria-hidden="true"
              className="absolute h-[3px] rounded-pill bg-accent-violet"
              style={{
                left: TRACK_LEFT + LABEL_WIDTH,
                top: rowsTop - 6,
                width: (trackWidth * completedTicks) / totalTicks,
              }}
            />
          )}

          <div
            aria-hidden="true"
            className="absolute w-px bg-[rgba(255,255,255,0.85)]"
            style={{
              left: TRACK_LEFT + LABEL_WIDTH + trackWidth * cursorRatio,
              top: rowsTop - 6,
              height: tracks.length * (rowHeight + ROW_GAP) + 6,
            }}
          />

          <div
            className="absolute flex justify-between text-caption text-ink-muted"
            style={{ left: TRACK_LEFT + LABEL_WIDTH, width: trackWidth, bottom: 14 }}
            data-numeric
          >
            {hourTicks(horizonS).map((seconds) => (
              <span key={seconds}>{formatClock(seconds)}</span>
            ))}
          </div>

          {baselineLabel !== undefined && (
            <p className="absolute bottom-[14px] right-[24px] text-caption text-ink-muted">
              {baselineLabel}
            </p>
          )}

          <p className="absolute bottom-[14px] left-[36px] text-caption text-ink-muted">
            Space — пуск/пауза · ← → — шаг · Home/End — края
          </p>
        </>
      )}

      {hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 w-[268px] rounded-sm border border-line bg-surface-raised px-[13px] py-[9px] shadow-card"
          style={{ left: Math.min(Math.max(hover.x - 134, 8), width - 276), top: 23 }}
        >
          <p className="flex items-center gap-[8px] text-caption font-semibold text-ink-primary">
            <span
              aria-hidden="true"
              className="size-[10px] rounded-[3px]"
              style={{ background: segmentColor(hover.segment.cause) }}
            />
            {hover.clientId} · {formatClock(hover.segment.startTick * stepS)}–
            {formatClock(hover.segment.endTick * stepS)}
            {hover.baseline && ' · до'}
          </p>
          <p className="mt-[4px] text-micro text-ink-secondary">
            {hover.segment.cause === null ? 'Связь есть' : CAUSE_LABEL[hover.segment.cause]} ·{' '}
            {formatSpan((hover.segment.endTick - hover.segment.startTick) * stepS)}
            {(hover.segment.startTick === 0 || hover.segment.endTick === totalTicks) &&
              hover.segment.cause !== null &&
              ' · обрезан границей расчёта'}
          </p>
        </div>
      )}
    </section>
  );
}

function TrackStrip({
  width,
  height,
  track,
  totalTicks,
  stepS,
  onSeekTick,
  onHover,
  onSelectOutage,
}: {
  width: number;
  height: number;
  track: TimelineTrack;
  totalTicks: number;
  stepS: number;
  onSeekTick: (tick: number) => void;
  onHover: (
    hover: { clientId: string; segment: TimelineSegment; x: number; baseline: boolean } | null,
  ) => void;
  onSelectOutage?: ((clientId: string, startS: number) => void) | undefined;
}) {
  const strip = useRef<HTMLDivElement>(null);

  const seekFromEvent = (clientX: number): void => {
    const box = strip.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) {
      return;
    }
    onSeekTick(Math.round(((clientX - box.left) / box.width) * (totalTicks - 1)));
  };

  const hasBaseline = track.baseline !== undefined;
  const mainHeight = hasBaseline ? height - 10 : height - 4;

  return (
    <div
      ref={strip}
      className="relative ml-[7px] cursor-ew-resize"
      style={{ width, height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          seekFromEvent(event.clientX);
        }
      }}
      onPointerLeave={() => {
        onHover(null);
      }}
    >
      {hasBaseline && (
        <div className="absolute inset-x-0 top-0 h-[6px]">
          {(track.baseline ?? []).map((segment) => (
            <Segment
              key={`base-${segment.startTick}`}
              segment={segment}
              totalTicks={totalTicks}
              clientId={track.clientId}
              stepS={stepS}
              baseline
              onHover={onHover}
            />
          ))}
        </div>
      )}

      <div className="absolute inset-x-0" style={{ top: hasBaseline ? 10 : 2, height: mainHeight }}>
        {track.segments.map((segment) => (
          <Segment
            key={segment.startTick}
            segment={segment}
            totalTicks={totalTicks}
            clientId={track.clientId}
            stepS={stepS}
            baseline={false}
            onHover={onHover}
            onSelect={
              segment.cause === null
                ? undefined
                : () => onSelectOutage?.(track.clientId, segment.startTick * stepS)
            }
          />
        ))}
      </div>

      <EdgeMark side="left" segments={track.segments} totalTicks={totalTicks} />
      <EdgeMark side="right" segments={track.segments} totalTicks={totalTicks} />
    </div>
  );
}

function Segment({
  segment,
  totalTicks,
  clientId,
  stepS,
  baseline,
  onHover,
  onSelect,
}: {
  segment: TimelineSegment;
  totalTicks: number;
  clientId: string;
  stepS: number;
  baseline: boolean;
  onHover: (
    hover: { clientId: string; segment: TimelineSegment; x: number; baseline: boolean } | null,
  ) => void;
  onSelect?: (() => void) | undefined;
}) {
  const left = (segment.startTick / totalTicks) * 100;
  const width = ((segment.endTick - segment.startTick) / totalTicks) * 100;

  return (
    <span
      role={onSelect === undefined ? undefined : 'button'}
      tabIndex={onSelect === undefined ? undefined : 0}
      aria-label={
        onSelect === undefined
          ? undefined
          : `${clientId}: перерыв с ${formatClock(segment.startTick * stepS)}`
      }
      className="absolute inset-y-0 rounded-[2px]"
      style={{ left: `${left}%`, width: `${width}%`, background: segmentColor(segment.cause) }}
      onMouseEnter={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const parent = event.currentTarget.offsetParent?.getBoundingClientRect();
        onHover({
          clientId,
          segment,
          x: box.left + box.width / 2 - (parent?.left ?? 0),
          baseline,
        });
      }}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (onSelect !== undefined && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSelect();
        }
      }}
    />
  );
}

/** Перерыв, упирающийся в край расчёта, помечается стрелкой (ADR-004). */
function EdgeMark({
  side,
  segments,
  totalTicks,
}: {
  side: 'left' | 'right';
  segments: readonly TimelineSegment[];
  totalTicks: number;
}) {
  const segment = side === 'left' ? segments[0] : segments[segments.length - 1];
  const touching =
    segment !== undefined &&
    segment.cause !== null &&
    (side === 'left' ? segment.startTick === 0 : segment.endTick === totalTicks);
  if (!touching) {
    return null;
  }
  return (
    <span
      title="Перерыв обрезан границей расчёта"
      className={cx(
        'absolute top-1/2 -translate-y-1/2 text-caption font-bold text-ink-muted',
        side === 'left' ? '-left-[14px]' : '-right-[14px]',
      )}
    >
      {side === 'left' ? '‹' : '›'}
    </span>
  );
}

function TransportButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-[34px] items-center justify-center rounded-[10px] bg-surface-chip text-ink-secondary transition-colors duration-150 hover:text-ink-primary"
    >
      {children}
    </button>
  );
}

function CauseLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-[6px] whitespace-nowrap text-caption font-medium text-ink-secondary">
      <span aria-hidden="true" className="size-[12px] rounded-[3px]" style={{ background: color }} />
      {label}
    </li>
  );
}

function segmentColor(cause: OutageCause | null): string {
  return cause === null ? 'var(--chart-ok)' : `var(${CAUSE_VARIABLE[cause]})`;
}

/** Подписи шкалы: каждые три часа, если горизонт сутки; иначе восемь равных долей. */
function hourTicks(horizonS: number): number[] {
  const count = 8;
  return Array.from({ length: count + 1 }, (_, index) => (horizonS * index) / count);
}
