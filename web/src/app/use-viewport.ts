import { useCallback, useLayoutEffect, useState } from 'react';

import { readableTextSize } from '@/styles/readable-text';
import { CANVAS_WIDTH, scaleFor } from './use-canvas-scale';
import { modeFor, STACK_GUTTER, STACK_MAX_WIDTH, useStacked, type Viewport } from './viewport-mode';

function measure(): Viewport {
  const { innerWidth, innerHeight } = window;
  const mode = modeFor(innerWidth, innerHeight);
  if (mode === 'canvas') {
    return { mode, contentWidth: CANVAS_WIDTH };
  }
  return {
    mode,
    contentWidth: Math.min(STACK_MAX_WIDTH, innerWidth - STACK_GUTTER * 2),
  };
}

/**
 * Режим показа и доступная блокам ширина.
 *
 * `useLayoutEffect` ставит значение до первой отрисовки: иначе телефон успевает
 * показать макетное полотно в натуральную величину и мигнуть.
 *
 * Значение хранится целым объектом и заменяется только при настоящем изменении —
 * `ResizeObserver` на телефоне срабатывает на каждое появление адресной строки, и
 * перерисовывать из-за этого весь экран с тремя canvas нельзя.
 */
export function useViewportState(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === 'undefined' ? { mode: 'canvas', contentWidth: CANVAS_WIDTH } : measure(),
  );

  useLayoutEffect(() => {
    const apply = (): void => {
      const next = measure();
      setViewport((current) =>
        current.mode === next.mode && current.contentWidth === next.contentWidth ? current : next,
      );
    };

    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(document.documentElement);
    window.addEventListener('resize', apply);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return viewport;
}

function currentScale(): number {
  return typeof window === 'undefined' ? 1 : scaleFor(window.innerWidth, window.innerHeight);
}

/**
 * Кегль с компенсацией для текста, который рисуется в обход CSS: подписи графиков ECharts
 * и холста карты. Правило то же, что у классов `text-*` (`styles/readable-text.ts`).
 *
 * Коэффициент хранится здесь, а не в общем контексте режима: он меняется при каждом
 * изменении окна, и через контекст из-за него перерисовывался бы весь экран, а не только
 * графики. В потоке полотна нет, и размер возвращается как есть.
 */
export function useCanvasTextSize(): (px: number) => number {
  const stacked = useStacked();
  const [scale, setScale] = useState(currentScale);

  useLayoutEffect(() => {
    const apply = (): void => {
      setScale(currentScale());
    };

    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(document.documentElement);
    window.addEventListener('resize', apply);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return useCallback((px: number) => (stacked ? px : readableTextSize(px, scale)), [stacked, scale]);
}
