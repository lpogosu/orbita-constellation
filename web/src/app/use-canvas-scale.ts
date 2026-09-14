import { useLayoutEffect } from 'react';

/** Размер полотна макета в CSS-пикселях (Figma, экран «01 · Проекты», узел 1920×1080). */
export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

/**
 * Коэффициент, которым полотно ужимается или растягивается под окно. Берётся меньшая из
 * двух сторон: экран обязан помещаться целиком, а пропорции блоков — оставаться
 * макетными, поэтому по одной из осей остаётся поле.
 */
export function scaleFor(width: number, height: number): number {
  return Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT);
}

/**
 * Держит `--canvas-scale` в согласии с размером окна. `useLayoutEffect` ставит значение
 * до первой отрисовки, иначе полотно успевает мигнуть в натуральную величину.
 */
export function useCanvasScale(): void {
  useLayoutEffect(() => {
    const apply = (): void => {
      const scale = scaleFor(window.innerWidth, window.innerHeight);
      document.documentElement.style.setProperty('--canvas-scale', scale.toFixed(5));
    };

    apply();

    // `resize` ловит изменение окна, наблюдатель — смену системного масштаба и
    // появление панелей браузера, при которых события `resize` может не быть.
    const observer = new ResizeObserver(apply);
    observer.observe(document.documentElement);
    window.addEventListener('resize', apply);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);
}
