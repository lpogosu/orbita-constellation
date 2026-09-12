import type { OutageCause, RoutingPolicy, RunStatus } from '@/api/types';

/** Прочерк ставится там, где значения нет в ответе API, а не там, где оно равно нулю. */
export const DASH = '—';

const HOUR = 3600;
const MINUTE = 60;

/** Доля [0; 1] в проценты: «96.67 %». Два знака — как в макете и в `ConfigMetrics`. */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(2)} %`;
}

/** Отсчёт от начала суток в «ЧЧ:ММ». Горизонт всегда начинается в 00:00 (ADR-004). */
export function formatTick(seconds: number): string {
  const total = Math.floor(seconds / MINUTE);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Длина перерыва: «8 мин», «3 ч 40 мин», «45 с». Секунды показываются только до минуты. */
export function formatGap(seconds: number): string {
  if (seconds < MINUTE) {
    return `${String(seconds)} с`;
  }
  const minutes = Math.round(seconds / MINUTE);
  if (minutes < 60) {
    return `${String(minutes)} мин`;
  }
  const rest = minutes % 60;
  const hours = (minutes - rest) / 60;
  return rest === 0 ? `${String(hours)} ч` : `${String(hours)} ч ${String(rest)} мин`;
}

/** Горизонт расчёта в часах, если он кратен часу: «24 ч». */
export function formatHorizon(seconds: number): string {
  return seconds % HOUR === 0 ? `${String(seconds / HOUR)} ч` : `${String(seconds)} с`;
}

/** Длительность расчёта из `duration_ms`: «17 с» или «2 мин 05 с». */
export function formatRunDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < MINUTE) {
    return `${String(seconds)} с`;
  }
  const rest = seconds % MINUTE;
  return `${String((seconds - rest) / MINUTE)} мин ${pad(rest)} с`;
}

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const SHORT_DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Время расчёта показывается в UTC и подписано «UTC». Расчёт детерминирован и его
 * результат сравнивают по `config_hash`; местная зона превратила бы одну и ту же метку в
 * разные строки на разных машинах в зале.
 */
export function formatUtcMoment(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

/** «03.03, 14:22» — колонка «запущен» в таблице прогонов. */
export function formatShortMoment(iso: string): string {
  return SHORT_DATE_TIME.format(new Date(iso));
}

/** «28.02.2026» — дата создания проекта и варианта. */
export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

/** Короткий `config_hash`: «9f2c…a71», как в макете. */
export function formatHash(hash: string): string {
  return `${hash.slice(0, 4)}…${hash.slice(-3)}`;
}

const POLICY_LABELS: Record<RoutingPolicy, string> = {
  bfs_shortest: 'BFS',
  persistent: 'BFS + hold',
  dijkstra_distance: 'Дейкстра',
};

export const ROUTING_POLICIES: readonly RoutingPolicy[] = [
  'bfs_shortest',
  'persistent',
  'dijkstra_distance',
];

export function policyLabel(policy: RoutingPolicy): string {
  return POLICY_LABELS[policy];
}

const STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'в очереди',
  running: 'считается',
  succeeded: 'успешно',
  failed: 'не удался',
  cancelled: 'отменён',
};

export function runStatusLabel(status: RunStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Причины отсутствия маршрута. Короткая подпись — для таблицы и подписи сегмента,
 * полная — из `03_GLOSSARY.md` §3.1 и уходит в подсказку: в колонку шириной 190 px
 * «Разрыв межспутниковой сети» не помещается, а смысл терять нельзя.
 */
interface CauseView {
  readonly short: string;
  readonly full: string;
  /** Переменная цвета сегмента шкалы и квадрата в таблице. */
  readonly color: string;
}

const CAUSES: Record<OutageCause, CauseView> = {
  NO_CLIENT_COVERAGE: {
    short: 'нет спутника',
    full: 'Нет видимых спутников',
    color: 'var(--chart-no-sat)',
  },
  GATEWAY_OUTAGE: {
    short: 'отказ шлюза',
    full: 'Шлюз недоступен',
    color: 'var(--chart-gateway-outage)',
  },
  NO_GATEWAY_COVERAGE: {
    short: 'нет шлюза',
    full: 'Нет связи со шлюзом',
    color: 'var(--chart-no-gateway)',
  },
  NETWORK_PARTITION: {
    short: 'разрыв ISL',
    full: 'Разрыв межспутниковой сети',
    color: 'var(--chart-isl-break)',
  },
  INTERNAL_INCONSISTENCY: {
    short: 'ошибка расчёта',
    full: 'Ошибка расчёта',
    color: 'var(--chart-internal)',
  },
};

export function causeView(cause: OutageCause): CauseView {
  return CAUSES[cause];
}

/** Буква варианта в проекте: A, B, C… — так на варианты ссылаются макет и защита. */
export function variantLetter(index: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = alphabet[index % alphabet.length] ?? '?';
  return index < alphabet.length ? letter : `${letter}${String(Math.floor(index / 26) + 1)}`;
}

/** Подпись варианта: буква и название — так на варианты ссылаются макет и защита. */
export function variantLabel(index: number, title: string): string {
  return `${variantLetter(index)} · ${title}`;
}

/** Короткая запись одного изменения: `design.planes[1].raan_deg 60 → 72`. */
export function changeText(change: {
  path: string;
  from: boolean | number | string | null;
  to: boolean | number | string | null;
}): string {
  return `${change.path}: ${valueText(change.from)} → ${valueText(change.to)}`;
}

function valueText(value: boolean | number | string | null): string {
  return value === null ? DASH : String(value);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}
