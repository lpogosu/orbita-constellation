import type { ClientTimeline, OutageCause } from '@/api/types';

/** Отрезок постоянного состояния: `cause === null` — маршрут есть. */
export interface TimelineSegment {
  readonly startTick: number;
  /** Первый отсчёт за отрезком, как и границы перерывов в API. */
  readonly endTick: number;
  readonly cause: OutageCause | null;
}

/**
 * Биты доступности приходят упакованными (`ADR-010`): base64 → байты → биты, старший бит
 * байта соответствует меньшему отсчёту (`numpy.packbits`, порядок big).
 */
export function unpackBitset(base64: string, totalTicks: number): Uint8Array {
  const binary = atob(base64);
  const bits = new Uint8Array(totalTicks);
  for (let tick = 0; tick < totalTicks; tick += 1) {
    const byte = binary.charCodeAt(tick >> 3);
    bits[tick] = (byte >> (7 - (tick & 7))) & 1;
  }
  return bits;
}

/**
 * Сжатие по соседним одинаковым отсчётам: 720 прямоугольников в разметке не нужны, а
 * отрезок «связи нет с 12:20 до 12:44 по одной причине» — это ровно то, что подсказка и
 * показывает.
 */
export function toSegments(timeline: ClientTimeline, totalTicks: number): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  if (totalTicks <= 0) {
    return segments;
  }

  const available = unpackBitset(timeline.availability_bitset, totalTicks);
  let startTick = 0;
  let current = stateAt(available, timeline.causes, 0);

  for (let tick = 1; tick < totalTicks; tick += 1) {
    const next = stateAt(available, timeline.causes, tick);
    if (next !== current) {
      segments.push({ startTick, endTick: tick, cause: current });
      startTick = tick;
      current = next;
    }
  }
  segments.push({ startTick, endTick: totalTicks, cause: current });

  return segments;
}

function stateAt(
  available: Uint8Array,
  causes: readonly (OutageCause | null)[],
  tick: number,
): OutageCause | null {
  if (available[tick] === 1) {
    return null;
  }
  // Маршрута нет, но причина не пришла: показывать «связь есть» было бы враньём, поэтому
  // отрезок помечается как ошибка расчёта — тем же значением, что и в enum.
  return causes[tick] ?? 'INTERNAL_INCONSISTENCY';
}

/** Секунды от начала расчёта → `ЧЧ:ММ`; сутки с лишним не переносятся в «25:00». */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Длительность перерыва словами: минуты, часы с минутами. */
export function formatSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}
