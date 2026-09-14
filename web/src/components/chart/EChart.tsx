import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import type { EChartsOption } from 'echarts';

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  VisualMapComponent,
  SVGRenderer,
]);

export interface ChartClick {
  readonly seriesIndex: number;
  readonly dataIndex: number;
}

interface EChartProps {
  /**
   * Размер в пикселях. На полотне это макетная величина: измерять DOM там нельзя, он
   * масштабирован `zoom`. В потоке `zoom` нет, и размер приходит из `useContainerSize`.
   */
  readonly width: number;
  readonly height: number;
  readonly option: EChartsOption;
  readonly onSelect?: (target: ChartClick) => void;
  readonly ariaLabel: string;
}

/**
 * Обёртка над ECharts.
 *
 * Рисование идёт в SVG, а не в canvas: экран живёт внутри полотна с `zoom`, и растровый
 * холст в нём размывается, потому что масштаб применяется уже к готовым пикселям.
 * Размер передаётся явно по той же причине — при `zoom` измерение элемента даёт не тот
 * размер, в котором график в итоге показывается.
 */
export function EChart({ width, height, option, onSelect, ariaLabel }: EChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  // Экземпляр создаётся один раз, а размер и настройки приходят позже: пересоздание при
  // каждом изменении ширины карточки в потоке оставляло бы новый экземпляр без рядов.
  const initial = useRef({ width, height, option });

  useEffect(() => {
    const element = host.current;
    if (element === null) {
      return;
    }
    const { width: startWidth, height: startHeight, option: startOption } = initial.current;
    const instance = echarts.init(element, null, {
      renderer: 'svg',
      width: Math.max(startWidth, 1),
      height: Math.max(startHeight, 1),
    });
    instance.setOption(startOption, { notMerge: true });
    chart.current = instance;
    instance.on('click', (event: { seriesIndex?: number; dataIndex?: number }) => {
      if (event.seriesIndex !== undefined && event.dataIndex !== undefined) {
        select.current?.({ seriesIndex: event.seriesIndex, dataIndex: event.dataIndex });
      }
    });
    return () => {
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // Контейнер в потоке ещё не измерен в первом кадре: нулевой размер ECharts не принимает.
    if (width > 0 && height > 0) {
      chart.current?.resize({ width, height });
    }
  }, [width, height]);

  useEffect(() => {
    // `notMerge` обязателен: при смене метрики число рядов меняется, и слияние настроек
    // оставило бы на карте ряды прошлой метрики.
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={host} role="img" aria-label={ariaLabel} style={{ width, height }} />;
}
