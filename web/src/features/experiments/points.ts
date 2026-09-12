import type { ExperimentPoint } from '@/api/types';
import { formatDecimal, formatGap, formatShareShort } from '@/lib/measures';

/** Метрика, которой красится тепловая карта. Все три приходят в `ExperimentPoint`. */
export type PointMetric =
  | 'min_client_availability'
  | 'worst_max_gap_s'
  | 'mean_client_availability';

export interface MetricDescriptor {
  readonly id: PointMetric;
  readonly title: string;
  /** Больше — лучше: определяет, с какого края шкалы зелёный цвет. */
  readonly better: 'up' | 'down';
  readonly read: (point: ExperimentPoint) => number | null;
  readonly format: (value: number) => string;
  /** Значение в единицах графика: доли переводятся в проценты, секунды — в минуты. */
  readonly chartValue: (value: number) => number;
}

export const METRICS: readonly MetricDescriptor[] = [
  {
    id: 'min_client_availability',
    title: 'min доступность',
    better: 'up',
    read: (point) => point.min_client_availability ?? null,
    format: formatShareShort,
    chartValue: (value) => value * 100,
  },
  {
    id: 'worst_max_gap_s',
    title: 'макс. окно',
    better: 'down',
    read: (point) => point.worst_max_gap_s ?? null,
    format: formatGap,
    chartValue: (value) => value / 60,
  },
  {
    id: 'mean_client_availability',
    title: 'средняя доступность',
    better: 'up',
    read: (point) => point.mean_client_availability ?? null,
    format: formatShareShort,
    chartValue: (value) => value * 100,
  },
];

export function metricById(id: PointMetric): MetricDescriptor {
  const found = METRICS.find((metric) => metric.id === id);
  if (found === undefined) {
    throw new Error(`Метрика ${id} не объявлена`);
  }
  return found;
}

/** Значения осей в том порядке, в котором их перебирал сервис: по возрастанию. */
export function axisValues(points: readonly ExperimentPoint[], path: string): number[] {
  const values = new Set<number>();
  for (const point of points) {
    const value = point.params[path];
    if (value !== undefined) {
      values.add(value);
    }
  }
  return [...values].sort((left, right) => left - right);
}

export function pointAt(
  points: readonly ExperimentPoint[],
  xPath: string,
  xValue: number,
  yPath: string | null,
  yValue: number | null,
): ExperimentPoint | undefined {
  return points.find(
    (point) =>
      point.params[xPath] === xValue &&
      (yPath === null || yValue === null || point.params[yPath] === yValue),
  );
}

/** Подпись точки: значения всех её осей словами параметров, а не путями в JSON. */
export function pointTitle(
  point: ExperimentPoint,
  titleOf: (path: string) => string,
): string {
  return Object.entries(point.params)
    .map(([path, value]) => `${titleOf(path)} ${formatDecimal(value, value % 1 === 0 ? 0 : 1)}`)
    .join(' · ');
}
