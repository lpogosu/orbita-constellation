import type { ClientTimeline, OutageCause } from '@/api/types';

/** Отрезок одного состояния: `[from; to)` в отсчётах; `cause: null` — маршрут есть. */
export interface TimelineSegment {
  readonly from: number;
  readonly to: number;
  readonly cause: OutageCause | null;
}

/**
 * Распаковывает битовую маску доступности и склеивает соседние отсчёты с одинаковой
 * причиной. Отсчётов 720 и больше (ADR-010), а отрезков — десятки: рисовать каждый
 * отсчёт отдельным элементом значило бы держать в разметке тысячи узлов ради полосы
 * шириной 0.6 px.
 */
export function segmentsOf(
  client: ClientTimeline,
  totalTicks: number,
): readonly TimelineSegment[] {
  const bits = unpack(client.availability_bitset, totalTicks);
  const segments: TimelineSegment[] = [];

  let from = 0;
  let current = causeAt(client, bits, 0);

  for (let tick = 1; tick < totalTicks; tick += 1) {
    const cause = causeAt(client, bits, tick);
    if (cause !== current) {
      segments.push({ from, to: tick, cause: current });
      from = tick;
      current = cause;
    }
  }

  if (totalTicks > 0) {
    segments.push({ from, to: totalTicks, cause: current });
  }
  return segments;
}

function causeAt(
  client: ClientTimeline,
  bits: Uint8Array,
  tick: number,
): OutageCause | null {
  if (bits[tick] === 1) {
    return null;
  }
  // Причина без маршрута обязана быть: пустое место в `causes[]` — расхождение ядра.
  return client.causes[tick] ?? 'INTERNAL_INCONSISTENCY';
}

/** `np.packbits` укладывает отсчёты старшим битом вперёд, распаковка идёт так же. */
function unpack(bitset: string, totalTicks: number): Uint8Array {
  const binary = atob(bitset);
  const bits = new Uint8Array(totalTicks);
  for (let tick = 0; tick < totalTicks; tick += 1) {
    const byte = binary.charCodeAt(tick >> 3);
    bits[tick] = Number.isNaN(byte) ? 0 : (byte >> (7 - (tick & 7))) & 1;
  }
  return bits;
}
