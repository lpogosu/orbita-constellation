import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';

import type { ExperimentPoint } from '@/api/types';
import { useCanvasTextSize } from '@/app/use-viewport';
import { useStacked } from '@/app/viewport-mode';
import { EChart } from '@/components/chart/EChart';
import { useContainerSize } from '@/components/layout/box';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { useTokenColors } from '@/theme/use-token-colors';
import { axisValues, METRICS, metricById } from './points';
import type { MetricDescriptor, PointMetric } from './points';

const LEFT = 465;
const TOP = 200;
const CHART_WIDTH = 872;
const CHART_HEIGHT = 336;
/** Высота графика в потоке: карточка там ниже макетной, а подписи ячеек те же. */
const STACKED_CHART_HEIGHT = 320;
/**
 * Ячейка уже 72 пикселей не вмещает значение и подпись под ним: в узкой колонке карта
 * становится шире карточки и прокручивается внутри неё, а не сжимает подписи в кашу.
 */
const MIN_CELL_WIDTH = 72;
/** Отступ сетки под подписи оси Y: значения осей короткие, макетные 78 пикселей велики. */
const STACKED_GRID_LEFT = 40;
const MIN_POINT_GAP = 28;

interface HeatmapCardProps {
  readonly points: readonly ExperimentPoint[];
  readonly xPath: string;
  readonly yPath: string | null;
  readonly axisTitle: (path: string) => string;
  readonly metric: PointMetric;
  readonly target: number;
  readonly selectedPointId: string | null;
  readonly onSelect: (point: ExperimentPoint) => void;
  readonly onMetric: (metric: PointMetric) => void;
  /** Место карточки в сетке потока; на полотне не используется. */
  readonly stackedClassName?: string;
}

/**
 * «Тепловая карта конфигураций» (узел `143:1128`). Значение подписано в каждой ячейке, а
 * цвет только помогает найти область: цвет — не единственный признак, иначе карта нечитаема
 * при нарушении цветовосприятия (`07_UI.md`).
 *
 * Пунктирная рамка ячейки всегда означает одно и то же — точка достигла цели по худшему
 * клиенту, — независимо от того, какой метрикой карта покрашена.
 */
export function HeatmapCard({
  points,
  xPath,
  yPath,
  axisTitle,
  metric,
  target,
  selectedPointId,
  onSelect,
  onMetric,
  stackedClassName,
}: HeatmapCardProps) {
  const stacked = useStacked();
  const textSize = useCanvasTextSize();
  const [chartBox, chartBoxSize] = useContainerSize<HTMLDivElement>();
  const color = useTokenColors();
  const descriptor = metricById(metric);

  const xValues = useMemo(() => axisValues(points, xPath), [points, xPath]);
  const yValues = useMemo(
    () => (yPath === null ? [] : axisValues(points, yPath)),
    [points, yPath],
  );

  const option = useMemo<EChartsOption>(
    () =>
      yPath === null
        ? lineOption({ points, xPath, xValues, descriptor, target, color, textSize })
        : heatmapOption({
            compact: stacked,
            points,
            xPath,
            yPath,
            xValues,
            yValues,
            descriptor,
            target,
            selectedPointId,
            color,
            textSize,
          }),
    [points, xPath, yPath, xValues, yValues, descriptor, target, selectedPointId, color, stacked, textSize],
  );

  const ordered = useMemo(
    () => orderedPoints(points, xPath, yPath, descriptor),
    [points, xPath, yPath, descriptor],
  );

  const title = (
    <h2
      className={cx(
        'text-[18px] font-semibold text-ink-primary',
        !stacked && 'absolute left-[23px] top-[17px]',
      )}
    >
      Тепловая карта конфигураций
    </h2>
  );

  const metricSwitch = (
    <div
      className={cx(
        'rounded-sm border border-line bg-surface-input p-[2px]',
        stacked
          ? 'grid w-full grid-cols-3 sm:flex sm:w-auto'
          : 'absolute right-[23px] top-[13px] flex h-[30px] items-center',
      )}
    >
      {METRICS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.id === metric}
          onClick={() => { onMetric(item.id); }}
          className={cx(
            'rounded-[7px] text-[12px] font-semibold transition-colors duration-150',
            stacked ? 'min-h-[40px] px-[10px] leading-[1.2]' : 'h-[26px] px-[14px]',
            item.id === metric
              ? 'bg-accent-violet text-ink-onAccent'
              : 'text-ink-secondary hover:text-ink-primary',
          )}
        >
          {item.title}
        </button>
      ))}
    </div>
  );

  const ariaLabel =
    yPath === null
      ? `График ${descriptor.title} по параметру ${axisTitle(xPath)}`
      : `Тепловая карта ${descriptor.title} по параметрам ${axisTitle(xPath)} и ${axisTitle(yPath)}`;

  const select = ({ dataIndex }: { dataIndex: number }) => {
    const point = ordered[dataIndex];
    if (point !== undefined) {
      onSelect(point);
    }
  };

  if (stacked) {
    const minWidth =
      yPath === null
        ? 60 + xValues.length * MIN_POINT_GAP
        : STACKED_GRID_LEFT + 12 + xValues.length * MIN_CELL_WIDTH;
    return (
      <Card className={cx('flex flex-col gap-[12px] p-[20px]', stackedClassName)}>
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          {title}
          {metricSwitch}
        </div>
        <div ref={chartBox} className="scroll-area overflow-x-auto">
          <EChart
            width={Math.max(chartBoxSize.width, minWidth)}
            height={STACKED_CHART_HEIGHT}
            option={option}
            ariaLabel={ariaLabel}
            onSelect={select}
          />
        </div>
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[420px] w-[918px]"
      style={{ left: LEFT, top: TOP }}
    >
      {title}
      {metricSwitch}

      <div className="absolute left-[23px] top-[58px]">
        <EChart
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          option={option}
          ariaLabel={ariaLabel}
          onSelect={select}
        />
      </div>
    </Card>
  );
}

/**
 * Порядок точек в ряду ECharts: по нему клик по ячейке находит свою точку, поэтому он
 * обязан повторять порядок и пропуски данных ряда. У линии значения выровнены по оси и
 * пропусков нет — там место без точки остаётся пустым; на тепловой карте ячейки без
 * значения в ряд не попадают, и здесь они тоже пропускаются.
 */
function orderedPoints(
  points: readonly ExperimentPoint[],
  xPath: string,
  yPath: string | null,
  descriptor: MetricDescriptor,
): (ExperimentPoint | undefined)[] {
  const xValues = axisValues(points, xPath);
  if (yPath === null) {
    return xValues.map((x) => points.find((point) => point.params[xPath] === x));
  }

  const yValues = axisValues(points, yPath);
  const ordered: ExperimentPoint[] = [];
  for (const y of yValues) {
    for (const x of xValues) {
      const point = points.find(
        (item) => item.params[xPath] === x && item.params[yPath] === y,
      );
      if (point !== undefined && descriptor.read(point) !== null) {
        ordered.push(point);
      }
    }
  }
  return ordered;
}

interface HeatmapArgs {
  points: readonly ExperimentPoint[];
  xPath: string;
  yPath: string;
  xValues: readonly number[];
  yValues: readonly number[];
  descriptor: MetricDescriptor;
  target: number;
  selectedPointId: string | null;
  color: (name: string) => string;
  /** Кегль подписей графика с компенсацией ужатого полотна (`useCanvasTextSize`). */
  textSize: (px: number) => number;
  /** Узкая колонка потока: подпись ячейки короче, отступ под ось меньше. */
  compact: boolean;
}

function heatmapOption({
  points,
  xPath,
  yPath,
  xValues,
  yValues,
  descriptor,
  target,
  selectedPointId,
  color,
  textSize,
  compact,
}: HeatmapArgs): EChartsOption {
  const scale = [1, 2, 3, 4, 5].map((step) => color(`--heat-${step}`));
  const cellInk = color('--chart-cell-ink');
  const items: { value: [number, number, number]; itemStyle: Record<string, unknown> }[] = [];
  const captions: string[] = [];
  const raws: number[] = [];

  for (const [yIndex, y] of yValues.entries()) {
    for (const [xIndex, x] of xValues.entries()) {
      const point = points.find(
        (item) => item.params[xPath] === x && item.params[yPath] === y,
      );
      const raw = point === undefined ? null : descriptor.read(point);
      if (point === undefined || raw === null) {
        continue;
      }
      const reached = (point.min_client_availability ?? 0) >= target;
      items.push({
        value: [xIndex, yIndex, descriptor.chartValue(raw)],
        itemStyle: {
          borderColor: point.id === selectedPointId ? color('--text-primary') : color('--chart-target'),
          borderWidth: reached || point.id === selectedPointId ? 2 : 0,
          borderType: point.id === selectedPointId ? 'solid' : 'dashed',
          borderRadius: 8,
        },
      });
      raws.push(raw);
      captions.push(
        `${descriptor.format(raw)}|${reached ? (compact ? 'достигнута' : 'цель достигнута') : 'ниже цели'}`,
      );
    }
  }

  const values = items.map((item) => item.value[2]);
  const gridLeft = compact ? STACKED_GRID_LEFT : 78;

  return {
    animation: false,
    textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif' },
    grid: { left: gridLeft, right: 12, top: 26, bottom: 66 },
    tooltip: {
      backgroundColor: color('--surface-raised'),
      borderColor: color('--border-default'),
      textStyle: { color: color('--text-primary'), fontSize: textSize(13) },
      formatter: (params: unknown) => {
        const index = (params as { dataIndex: number }).dataIndex;
        const [value, caption] = (captions[index] ?? '').split('|');
        return `${descriptor.title}: ${value ?? '—'}<br />${caption ?? ''}`;
      },
    },
    xAxis: {
      type: 'category',
      data: xValues.map(String),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: color('--text-secondary'), fontSize: textSize(12) },
    },
    yAxis: {
      type: 'category',
      data: yValues.map(String),
      splitArea: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: color('--text-secondary'), fontSize: textSize(12) },
    },
    visualMap: {
      min: values.length === 0 ? 0 : Math.min(...values),
      max: values.length === 0 ? 1 : Math.max(...values),
      calculable: false,
      orient: 'horizontal',
      left: gridLeft,
      bottom: 4,
      // Шкала без подписей концов не отвечает, какой цвет какому значению соответствует.
      text:
        raws.length === 0
          ? ['', '']
          : [descriptor.format(Math.max(...raws)), descriptor.format(Math.min(...raws))],
      textGap: 8,
      itemWidth: 12,
      itemHeight: 180,
      textStyle: { color: color('--chart-axis'), fontSize: textSize(11) },
      inRange: { color: descriptor.better === 'up' ? scale : [...scale].reverse() },
    },
    series: [
      {
        type: 'heatmap',
        data: items,
        label: {
          show: true,
          formatter: (params: unknown) => {
            const index = (params as { dataIndex: number }).dataIndex;
            const [value, caption] = (captions[index] ?? '').split('|');
            return `{v|${value ?? ''}}\n{c|${caption ?? ''}}`;
          },
          rich: {
            v: { fontSize: textSize(14), fontWeight: 'bold', color: cellInk, lineHeight: textSize(14) + 4 },
            c: { fontSize: textSize(9), color: cellInk, lineHeight: textSize(9) + 3, opacity: 0.75 },
          },
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: color('--shadow-glow-blue') } },
      },
    ],
  };
}

function lineOption({
  points,
  xPath,
  xValues,
  descriptor,
  target,
  color,
  textSize,
}: {
  points: readonly ExperimentPoint[];
  xPath: string;
  xValues: readonly number[];
  descriptor: MetricDescriptor;
  target: number;
  color: (name: string) => string;
  textSize: (px: number) => number;
}): EChartsOption {
  const data = xValues.map((x) => {
    const point = points.find((item) => item.params[xPath] === x);
    const raw = point === undefined ? null : descriptor.read(point);
    return raw === null ? null : descriptor.chartValue(raw);
  });

  return {
    animation: false,
    textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif' },
    grid: { left: 60, right: 20, top: 26, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: color('--surface-raised'),
      borderColor: color('--border-default'),
      textStyle: { color: color('--text-primary'), fontSize: textSize(13) },
    },
    xAxis: {
      type: 'category',
      data: xValues.map(String),
      axisLine: { lineStyle: { color: color('--chart-grid') } },
      axisLabel: { color: color('--text-secondary'), fontSize: textSize(12) },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: color('--chart-axis'), fontSize: textSize(12) },
      splitLine: { lineStyle: { color: color('--chart-grid') } },
    },
    series: [
      {
        type: 'line',
        data,
        smooth: false,
        symbolSize: 10,
        lineStyle: { color: color('--accent-violet-light'), width: 2 },
        itemStyle: { color: color('--accent-violet-light') },
        ...(descriptor.better === 'up'
          ? {
              markLine: {
                silent: true,
                symbol: 'none' as const,
                data: [{ yAxis: target * 100 }],
                lineStyle: { color: color('--chart-target'), type: 'dashed' as const, width: 2 },
                label: { formatter: 'цель', color: color('--text-secondary'), fontSize: textSize(12) },
              },
            }
          : {}),
      },
    ],
  };
}
