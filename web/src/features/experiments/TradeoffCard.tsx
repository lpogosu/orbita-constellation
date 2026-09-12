import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';

import type { ExperimentPoint } from '@/api/types';
import { EChart } from '@/components/chart/EChart';
import { Card } from '@/components/ui/Card';
import { useTokenColors } from '@/theme/use-token-colors';

const LEFT = 465;
const TOP = 636;
const CHART_WIDTH = 872;
const CHART_HEIGHT = 162;

interface TradeoffCardProps {
  readonly points: readonly ExperimentPoint[];
  readonly target: number;
  readonly selectedPointId: string | null;
  readonly onSelect: (point: ExperimentPoint) => void;
}

/**
 * «min доступность и максимальное окно недоступности» (узел `144:1128`). Подпись говорит
 * «наблюдаемая зависимость на рассчитанных точках», а не «оптимум» (`07_UI.md`): точки
 * между узлами сетки никто не считал, и утверждать о них нечего.
 */
export function TradeoffCard({ points, target, selectedPointId, onSelect }: TradeoffCardProps) {
  const color = useTokenColors();

  const ready = useMemo(
    () =>
      points.filter(
        (point) =>
          point.min_client_availability !== null &&
          point.min_client_availability !== undefined &&
          point.worst_max_gap_s !== null &&
          point.worst_max_gap_s !== undefined,
      ),
    [points],
  );

  const option = useMemo<EChartsOption>(() => {
    const data = ready.map((point) => ({
      value: [(point.worst_max_gap_s ?? 0) / 60, (point.min_client_availability ?? 0) * 100],
      itemStyle: {
        color:
          (point.min_client_availability ?? 0) >= target
            ? color('--chart-ok')
            : color('--chart-no-sat'),
        borderColor: point.id === selectedPointId ? color('--text-primary') : 'transparent',
        borderWidth: point.id === selectedPointId ? 3 : 0,
      },
      symbolSize: point.id === selectedPointId ? 16 : 11,
    }));

    return {
      animation: false,
      textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif' },
      grid: { left: 56, right: 20, top: 16, bottom: 32 },
      tooltip: {
        backgroundColor: color('--surface-raised'),
        borderColor: color('--border-default'),
        textStyle: { color: color('--text-primary'), fontSize: 13 },
        formatter: (params: unknown) => {
          const value = (params as { value: [number, number] }).value;
          return `min доступность ${value[1].toFixed(1)} %<br />макс. окно ${value[0].toFixed(0)} мин`;
        },
      },
      xAxis: {
        type: 'value',
        name: 'макс. окно, мин',
        nameLocation: 'end',
        nameTextStyle: { color: color('--chart-axis'), fontSize: 11 },
        axisLine: { lineStyle: { color: color('--chart-grid') } },
        axisLabel: { color: color('--chart-axis'), fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: color('--chart-axis'), fontSize: 11, formatter: '{value} %' },
        splitLine: { lineStyle: { color: color('--chart-grid') } },
      },
      series: [
        {
          type: 'scatter',
          data,
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: target * 100 }],
            lineStyle: { color: color('--chart-target'), type: 'dashed', width: 2 },
            label: { formatter: 'цель', color: color('--text-secondary'), fontSize: 11 },
          },
        },
      ],
    };
  }, [ready, target, selectedPointId, color]);

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[220px] w-[918px]"
      style={{ left: LEFT, top: TOP }}
    >
      <h2 className="absolute left-[23px] top-[13px] text-[18px] font-semibold text-ink-primary">
        min доступность и максимальное окно недоступности
      </h2>
      <p className="absolute right-[23px] top-[19px] text-caption text-ink-muted">
        наблюдаемая зависимость на рассчитанных точках
      </p>

      <div className="absolute left-[23px] top-[44px]">
        <EChart
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          option={option}
          ariaLabel="Точечный график: минимальная доступность против максимального окна недоступности"
          onSelect={({ dataIndex }) => {
            const point = ready[dataIndex];
            if (point !== undefined) {
              onSelect(point);
            }
          }}
        />
      </div>
    </Card>
  );
}
