import type { ClientTimeline, OutageCause, RunTimeline } from '@/api/types';

/** Подписи причин перерыва из `03_GLOSSARY.md` §3.4 — интерфейс не сочиняет свои. */
export const CAUSE_TITLES: Record<OutageCause, string> = {
  NO_CLIENT_COVERAGE: 'Нет видимых спутников',
  GATEWAY_OUTAGE: 'Шлюз недоступен',
  NO_GATEWAY_COVERAGE: 'Нет связи со шлюзом',
  NETWORK_PARTITION: 'Разрыв межспутниковой сети',
  INTERNAL_INCONSISTENCY: 'Ошибка расчёта',
};

export const CAUSE_COLORS: Record<OutageCause, string> = {
  NO_CLIENT_COVERAGE: 'var(--chart-no-sat)',
  GATEWAY_OUTAGE: 'var(--chart-no-gateway)',
  NO_GATEWAY_COVERAGE: 'var(--chart-no-gateway)',
  NETWORK_PARTITION: 'var(--chart-isl-break)',
  INTERNAL_INCONSISTENCY: 'var(--chart-empty)',
};

/** Клетка шкалы: либо связь есть, либо названа причина, по которой её нет. */
export interface TimelineCell {
  readonly cause: OutageCause | null;
}

export interface ClientTrack {
  readonly clientId: string;
  readonly cells: readonly TimelineCell[];
  /** Непрерывные интервалы без связи в долях горизонта — для тонкой полосы варианта. */
  readonly outages: readonly { readonly from: number; readonly to: number }[];
}

/**
 * Больше клеток, чем это, на шкале шириной 1736 px не различить: каждая стала бы тоньше
 * двух пикселей и слилась с соседями. Шаг сетки в сценарии может быть куда мельче суток,
 * поэтому отсчёты собираются в клетки, а клетка берёт худшее состояние своих отсчётов —
 * перерыв виден, даже если он короче клетки.
 */
const MAX_CELLS = 720;

export function buildTracks(timeline: RunTimeline): ClientTrack[] {
  return timeline.clients.map((client) => buildTrack(client, timeline.total_ticks));
}

function buildTrack(client: ClientTimeline, totalTicks: number): ClientTrack {
  const available = unpackBits(client.availability_bitset, totalTicks);
  const size = Math.max(1, Math.ceil(totalTicks / MAX_CELLS));
  const cells: TimelineCell[] = [];

  for (let start = 0; start < totalTicks; start += size) {
    let cause: OutageCause | null = null;
    for (let tick = start; tick < Math.min(start + size, totalTicks); tick += 1) {
      if (available[tick] !== true) {
        cause = client.causes[tick] ?? cause ?? 'INTERNAL_INCONSISTENCY';
        break;
      }
    }
    cells.push({ cause });
  }

  return { clientId: client.client_id, cells, outages: outageRanges(available, totalTicks) };
}

function outageRanges(
  available: readonly boolean[],
  totalTicks: number,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let start: number | null = null;

  for (let tick = 0; tick <= totalTicks; tick += 1) {
    const broken = tick < totalTicks && available[tick] !== true;
    if (broken && start === null) {
      start = tick;
    }
    if (!broken && start !== null) {
      ranges.push({ from: start / totalTicks, to: tick / totalTicks });
      start = null;
    }
  }

  return ranges;
}

/**
 * Распаковка `availability_bitset` (ADR-010): сервис пакует биты `numpy.packbits`, то есть
 * старшим битом вперёд, и отдаёт их base64. Значимых бит ровно `total_ticks`, хвост байта
 * добит нулями и читаться не должен.
 */
export function unpackBits(encoded: string, totalTicks: number): boolean[] {
  const binary = atob(encoded);
  const bits: boolean[] = new Array<boolean>(totalTicks);

  for (let index = 0; index < totalTicks; index += 1) {
    const byte = binary.charCodeAt(index >> 3);
    bits[index] = ((byte >> (7 - (index & 7))) & 1) === 1;
  }

  return bits;
}
