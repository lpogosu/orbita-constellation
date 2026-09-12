import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';

import type { ComparisonEntry } from '@/api/types';
import { EChart } from '@/components/chart/EChart';
import { Card } from '@/components/ui/Card';
import { useTokenColors } from '@/theme/use-token-colors';
import { slotToken } from './slots';

const LEFT = 26;
const TOP = 564;
const CHART_WIDTH = 1098;
const CHART_HEIGHT = 212;

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
  const base = entries[0];

  const option = useMemo<EChartsOption>(() => {
    const clients = base?.clients.map((client) => client.client_id) ?? [];
    const axis = color('--chart-axis');

    return {
      animation: false,
      grid: { left: 46, right: 12, top: 18, bottom: 34 },
      textStyle: { fontFamily: 'Inter Variable, Inter, sans-serif' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: color('--surface-raised'),
        borderColor: color('--border-default'),
        textStyle: { color: color('--text-primary'), fontSize: 13 },
        valueFormatter: (value) => `${Number(value).toFixed(2)} %`,
      },
      xAxis: {
        type: 'category',
        data: clients,
        axisLine: { lineStyle: { color: color('--chart-grid') } },
        axisTick: { show: false },
        axisLabel: { color: color('--text-primary'), fontSize: 17, fontWeight: 600 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: { color: axis, fontSize: 12, formatter: '{value}%' },
        splitLine: { lineStyle: { color: color('--chart-grid') } },
      },
      series: entries.map((entry, index) => ({
        type: 'bar' as const,
        name: entry.variant_title,
        barMaxWidth: 42,
        itemStyle: { color: color(slotToken(index)), borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: 'top' as const,
          color: color('--text-primary'),
          fontSize: 12,
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
                  fontSize: 13,
                },
              },
            }
          : {}),
      })),
    };
  }, [base, entries, target, color]);

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[288px] w-[1160px]"
      style={{ left: LEFT, top: TOP }}
    >
      <h2 className="absolute left-[31px] top-[17px] text-title-m font-semibold text-ink-primary">
        Доступность клиентов по сценариям
      </h2>

      <div className="absolute right-[31px] top-[21px] flex items-center gap-[22px]">
        {entries.map((entry, index) => (
          <span key={entry.run_id} className="flex items-center gap-[8px] text-small text-ink-secondary">
            <span
              aria-hidden="true"
              className="size-[12px] rounded-full"
              style={{ background: `var(${slotToken(index)})` }}
            />
            <span className="max-w-[180px] truncate">{entry.variant_title}</span>
          </span>
        ))}
        {target !== null && (
          <span className="flex items-center gap-[8px] text-small text-ink-secondary">
            <span
              aria-hidden="true"
              className="h-0 w-[26px] border-t-2 border-dashed"
              style={{ borderColor: 'var(--chart-target)' }}
            />
            Цель {(target * 100).toFixed(0)} %
          </span>
        )}
      </div>

      <div className="absolute left-[31px] top-[56px]">
        <EChart
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          option={option}
          ariaLabel="Столбчатый график доступности по клиентам для каждого варианта"
        />
      </div>
    </Card>
  );
}
