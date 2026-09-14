import type { ClientComparison, ComparisonEntry } from '@/api/types';
import { deltaArrow, deltaTone, formatDecimal, formatPoints } from '@/lib/measures';
import type { Better } from '@/lib/measures';
import { formatGap, formatShare } from '@/lib/run-format';

/** Ячейка таблицы: значение показателя и его отличие от базы. */
export interface Cell {
  readonly value: string;
  readonly delta: string | null;
  readonly tone: 'good' | 'bad' | 'flat';
}

export interface MetricRow {
  readonly id: string;
  readonly title: string;
  readonly cell: (entry: ComparisonEntry, base: ComparisonEntry) => Cell;
}

export interface MetricSection {
  readonly title: string;
  readonly rows: readonly MetricRow[];
}

const NO_DELTA: Cell['tone'] = 'flat';

/**
 * Показатели конфигурации целиком. Ключи дельт — те же имена, что и в `ComparisonEntry.deltas`
 * (`05_API.md` §1): у базы словарь пуст, у остальных заполнен сервисом, и фронтенд ничего
 * не вычитает сам.
 */
const CONFIG_ROWS: readonly MetricRow[] = [
  shareRow('min_client_availability', 'min доступность клиента', (entry) =>
    entry.config.min_client_availability,
  ),
  shareRow('mean_client_availability', 'средняя доступность', (entry) =>
    entry.config.mean_client_availability,
  ),
  gapRow('worst_max_gap_s', 'макс. окно недоступности', (entry) => entry.config.worst_max_gap_s),
  numberRow('mean_hops', 'среднее число переходов', 'down', (entry) => entry.config.mean_hops, 2),
  numberRow(
    'route_switches_total',
    'переключений маршрута',
    'down',
    (entry) => entry.config.route_switches_total,
    0,
  ),
  numberRow(
    'backup_path_count_min',
    'резервных путей, минимум',
    'up',
    (entry) => entry.config.backup_path_count_min,
    0,
  ),
  {
    id: 'target_met_clients',
    title: 'клиентов достигли цели',
    cell: (entry) => ({
      value: `${entry.config.target_met_clients.length} из ${entry.clients.length}`,
      // Дельты по этому показателю сервис не считает, а вычитать длины списков на экране
      // значило бы выдать арифметику браузера за результат расчёта.
      delta: null,
      tone: NO_DELTA,
    }),
  },
];

/** Разделы таблицы: конфигурация целиком и те же показатели по каждому клиенту. */
export function metricSections(base: ComparisonEntry): MetricSection[] {
  const clients = base.clients.map((client) => client.client_id);

  return [
    { title: 'КОНФИГУРАЦИЯ', rows: CONFIG_ROWS },
    {
      title: 'ДОСТУПНОСТЬ ПО КЛИЕНТАМ',
      rows: clients.map((clientId) => ({
        id: `availability:${clientId}`,
        title: clientId,
        cell: (entry: ComparisonEntry): Cell => {
          const metrics = entry.clients.find((client) => client.client_id === clientId);
          const change = clientChange(entry, clientId);
          return {
            value: metrics === undefined ? '—' : formatShare(metrics.availability),
            delta:
              change === undefined
                ? null
                : `${deltaArrow(change.availability_delta)} ${formatPoints(change.availability_delta)}`,
            tone: change === undefined ? NO_DELTA : deltaTone(change.availability_delta, 'up'),
          };
        },
      })),
    },
    {
      title: 'МАКСИМАЛЬНОЕ ОКНО ПО КЛИЕНТАМ',
      rows: clients.map((clientId) => ({
        id: `gap:${clientId}`,
        title: clientId,
        cell: (entry: ComparisonEntry): Cell => {
          const metrics = entry.clients.find((client) => client.client_id === clientId);
          const change = clientChange(entry, clientId);
          return {
            value: metrics === undefined ? '—' : formatGap(metrics.max_gap_s),
            delta:
              change === undefined
                ? null
                : `${deltaArrow(change.max_gap_delta_s)} ${formatGap(change.max_gap_delta_s)}`,
            tone: change === undefined ? NO_DELTA : deltaTone(change.max_gap_delta_s, 'down'),
          };
        },
      })),
    },
  ];
}

export function clientChange(
  entry: ComparisonEntry,
  clientId: string,
): ClientComparison | undefined {
  return entry.per_client.find((client) => client.client_id === clientId);
}

function shareRow(
  key: string,
  title: string,
  read: (entry: ComparisonEntry) => number,
): MetricRow {
  return {
    id: key,
    title,
    cell: (entry) => {
      const delta = entry.deltas[key];
      return {
        value: formatShare(read(entry)),
        delta: delta === undefined ? null : `${deltaArrow(delta)} ${formatPoints(delta)}`,
        tone: delta === undefined ? NO_DELTA : deltaTone(delta, 'up'),
      };
    },
  };
}

function gapRow(key: string, title: string, read: (entry: ComparisonEntry) => number): MetricRow {
  return {
    id: key,
    title,
    cell: (entry) => {
      const delta = entry.deltas[key];
      return {
        value: formatGap(read(entry)),
        delta: delta === undefined ? null : `${deltaArrow(delta)} ${formatGap(delta)}`,
        tone: delta === undefined ? NO_DELTA : deltaTone(delta, 'down'),
      };
    },
  };
}

function numberRow(
  key: string,
  title: string,
  better: Better,
  read: (entry: ComparisonEntry) => number | null | undefined,
  digits: number,
): MetricRow {
  return {
    id: key,
    title,
    cell: (entry) => {
      const value = read(entry);
      const delta = entry.deltas[key];
      return {
        value: value === null || value === undefined ? '—' : formatDecimal(value, digits),
        delta:
          delta === undefined ? null : `${deltaArrow(delta)} ${formatDecimal(Math.abs(delta), digits)}`,
        tone: delta === undefined ? NO_DELTA : deltaTone(delta, better),
      };
    },
  };
}

/**
 * Цвет дельты по её пользе. Нулевая дельта — не проигрыш: раньше «= 0.00 п.п.» на
 * карточке варианта красилась красным, будто вариант хуже базы.
 */
export function deltaToneClass(delta: number, better: Better): string {
  const tone = deltaTone(delta, better);
  return tone === 'good' ? 'text-status-success' : tone === 'bad' ? 'text-status-danger' : 'text-ink-muted';
}
