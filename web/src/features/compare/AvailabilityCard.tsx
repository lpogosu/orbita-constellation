import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';

import type { ComparisonEntry } from '@/api/types';
import { EChart } from '@/components/chart/EChart';
import { Card } from '@/components/ui/Card';
import { useCanvasTextSize } from '@/app/use-viewport';
import { useViewport } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import { useTokenColors } from '@/theme/use-token-colors';
import { slotToken } from './slots';

const LEFT = 26;
const TOP = 564;
const CHART_WIDTH = 1098;
const CHART_HEIGHT = 212;
/** Поле карточки в потоке: ширина графика — колонка минус поле и рамка с двух сторон. */
const STACKED_PADDING = 16;
const CARD_BORDERS = 2;
const STACKED_CHART_HEIGHT = 240;

/**
 * «Доступность клиентов по сценариям» (узел Figma `46:513`): столбик на клиента и вариант,
 * пунктир — целевая доступность из сценария. Цель показана линией, а не цветом столбика:
 * на графике важно, насколько вариант до неё не дотянул, а не только сам факт.
 */
export function AvailabilityCard({
  entries,
  target,
}: {
  entries: readonly ComparisonEntry[];
  target: number | null;
}) {
  const color = useTokenColors();
  const { mode, contentWidth } = useViewport();
  const stacked = mode === 'stacked';
  const textSize = useCanvasTextSize();
  const base = entries[0];

  const option = useMemo<EChartsOption>(() => {
    const clients = base?.clients.map((client) => client.client_id) ?? [];
    const axis = color('--chart-axis');
    // Подписи значений над соседними столбиками в макете разделены узким зазором. На
    // ноутбуке они растут вместе с текстом и слипались, поэтому столбики группы расходятся
    // на ту же долю. 20 % — зазор ECharts по умолчанию: на 1920×1080 он прежний.
    const barGap = `${Math.round(20 + (textSize(12) / 12 - 1) * 100)}%`;

    return {
      animation: false,
      grid: { left: 46, right: 12, top: 18, bottom: 34 },
      textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: color('--surface-raised'),
        borderColor: color('--border-default'),
        textStyle: { color: color('--text-primary'), fontSize: textSize(13) },
        valueFormatter: (value) => `${Number(value).toFixed(2)} %`,
      },
      xAxis: {
        type: 'category',
        data: clients,
        axisLine: { lineStyle: { color: color('--chart-grid') } },
        axisTick: { show: false },
        axisLabel: { color: color('--text-primary'), fontSize: stacked ? 14 : textSize(17), fontWeight: 600 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: { color: axis, fontSize: textSize(12), formatter: '{value}%' },
        splitLine: { lineStyle: { color: color('--chart-grid') } },
      },
      series: entries.map((entry, index) => ({
        type: 'bar' as const,
        name: entry.variant_title,
        barMaxWidth: 42,
        barGap,
        itemStyle: { color: color(slotToken(index)), borderRadius: [4, 4, 0, 0] },
        label: {
          // На телефоне столбики уже подписей в два знака после запятой: значения
          // остаются в подсказке по касанию.
          show: !stacked || contentWidth >= 600,
          position: 'top' as const,
          color: color('--text-primary'),
          fontSize: textSize(12),
          formatter: (params: { value: unknown }) => `${Number(params.value).toFixed(2)}%`,
        },
        data: clients.map((clientId) => {
          const metrics = entry.clients.find((client) => client.client_id === clientId);
          return metrics === undefined ? null : metrics.availability * 100;
        }),
        ...(index === 0 && target !== null
          ? {
              markLine: {
                silent: true,
                symbol: 'none' as const,
                data: [{ yAxis: target * 100 }],
                lineStyle: { color: color('--chart-target'), type: 'dashed' as const, width: 2 },
                label: {
                  formatter: `${(target * 100).toFixed(0)}%`,
                  color: color('--text-primary'),
                  fontSize: textSize(13),
                },
              },
            }
          : {}),
      })),
    };
  }, [base, entries, target, color, stacked, contentWidth, textSize]);

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={stacked ? 'order-4 md:col-span-2' : 'absolute h-[288px] w-[1160px]'}
      style={stacked ? { padding: STACKED_PADDING } : { left: LEFT, top: TOP }}
    >
      <h2
        className={cx(
          'text-title-m font-semibold text-ink-primary',
          !stacked && 'absolute left-[31px] top-[17px]',
        )}
      >
        Доступность клиентов по сценариям
      </h2>

      {/* Легенда прижата к правому краю и ограничена по ширине: четыре названия вариантов
          подряд доходили до заголовка карточки. В потоке она идёт строкой под заголовком. */}
      <div
        className={cx(
          'flex flex-wrap items-center gap-x-[22px] gap-y-[4px]',
          stacked ? 'mt-[8px]' : 'absolute right-[31px] top-[21px] max-w-[790px] justify-end',
        )}
      >
        {entries.map((entry, index) => (
          <span key={entry.run_id} className="flex items-center gap-[8px] text-small text-ink-secondary">
            <span
              aria-hidden="true"
              className="size-[12px] shrink-0 rounded-full"
              style={{ background: `var(${slotToken(index)})` }}
            />
            <span className="max-w-[120px] truncate" title={entry.variant_title}>
              {entry.variant_title}
            </span>
          </span>
        ))}
        {target !== null && (
          <span className="flex shrink-0 items-center gap-[8px] whitespace-nowrap text-small text-ink-secondary">
            <span
              aria-hidden="true"
              className="h-0 w-[26px] border-t-2 border-dashed"
              style={{ borderColor: 'var(--chart-target)' }}
            />
            Цель {(target * 100).toFixed(0)} %
          </span>
        )}
      </div>

      <div className={stacked ? 'mt-[8px]' : 'absolute left-[31px] top-[56px]'}>
        <EChart
          width={stacked ? contentWidth - STACKED_PADDING * 2 - CARD_BORDERS : CHART_WIDTH}
          height={stacked ? STACKED_CHART_HEIGHT : CHART_HEIGHT}
          option={option}
          ariaLabel="Столбчатый график доступности по клиентам для каждого варианта"
        />
      </div>
    </Card>
  );
}
