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

const LEFT = 465;
const TOP = 636;
const CHART_WIDTH = 872;
const CHART_HEIGHT = 162;
/** В потоке у графика нет соседей по высоте, и точкам даётся больше места. */
const STACKED_CHART_HEIGHT = 220;

interface TradeoffCardProps {
  readonly points: readonly ExperimentPoint[];
  readonly target: number;
  readonly selectedPointId: string | null;
  readonly onSelect: (point: ExperimentPoint) => void;
  /** Место карточки в сетке потока; на полотне не используется. */
  readonly stackedClassName?: string;
}

/**
 * «min доступность и максимальное окно недоступности» (узел `144:1128`). Подпись говорит
 * «наблюдаемая зависимость на рассчитанных точках», а не «оптимум» (`07_UI.md`): точки
 * между узлами сетки никто не считал, и утверждать о них нечего.
 */
export function TradeoffCard({
  points,
  target,
  selectedPointId,
  onSelect,
  stackedClassName,
}: TradeoffCardProps) {
  const stacked = useStacked();
  const textSize = useCanvasTextSize();
  const [chartBox, chartBoxSize] = useContainerSize<HTMLDivElement>();
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
      // Подпись оси X стоит под осью, а не у её конца: в конце она вместе с меткой «цель»
      // уходила за правый край графика.
      grid: { left: 56, right: 36, top: 16, bottom: 40 },
      tooltip: {
        backgroundColor: color('--surface-raised'),
        borderColor: color('--border-default'),
        textStyle: { color: color('--text-primary'), fontSize: textSize(13) },
        formatter: (params: unknown) => {
          const value = (params as { value: [number, number] }).value;
          return `min доступность ${value[1].toFixed(1)} %<br />макс. окно ${value[0].toFixed(0)} мин`;
        },
      },
      xAxis: {
        type: 'value',
        name: 'макс. окно, мин',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: color('--chart-axis'), fontSize: textSize(11) },
        axisLine: { lineStyle: { color: color('--chart-grid') } },
        axisLabel: { color: color('--chart-axis'), fontSize: textSize(11) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: color('--chart-axis'), fontSize: textSize(11), formatter: '{value} %' },
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
            label: { formatter: 'цель', color: color('--text-secondary'), fontSize: textSize(11) },
          },
        },
      ],
    };
  }, [ready, target, selectedPointId, color, textSize]);

  const select = ({ dataIndex }: { dataIndex: number }) => {
    const point = ready[dataIndex];
    if (point !== undefined) {
      onSelect(point);
    }
  };
  const ariaLabel =
    'Точечный график: минимальная доступность против максимального окна недоступности';

  const heading = (
    <>
      <h2
        className={cx(
          'text-[18px] font-semibold text-ink-primary',
          !stacked && 'absolute left-[23px] top-[13px]',
        )}
      >
        min доступность и максимальное окно недоступности
      </h2>
      {/* На полотне подпись делит строку с заголовком: подросший на ноутбуке кегль
          сдвигал её влево до наложения, поэтому ширина ограничена местом справа от
          заголовка, а не собственной длиной. */}
      <p
        className={cx(
          'text-caption text-ink-muted',
          !stacked && 'absolute right-[23px] top-[19px] max-w-[360px] truncate',
        )}
        title="наблюдаемая зависимость на рассчитанных точках"
      >
        наблюдаемая зависимость на рассчитанных точках
      </p>
    </>
  );

  if (stacked) {
    return (
      <Card className={cx('flex flex-col gap-[4px] p-[20px]', stackedClassName)}>
        {heading}
        <div ref={chartBox} className="mt-[8px] min-w-0" style={{ height: STACKED_CHART_HEIGHT }}>
          {chartBoxSize.width > 0 && (
            <EChart
              width={chartBoxSize.width}
              height={STACKED_CHART_HEIGHT}
              option={option}
              ariaLabel={ariaLabel}
              onSelect={select}
            />
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[220px] w-[918px]"
      style={{ left: LEFT, top: TOP }}
    >
      {heading}

      <div className="absolute left-[23px] top-[44px]">
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
