import { createContext, useContext } from 'react';

import { CANVAS_WIDTH, scaleFor } from './use-canvas-scale';

/**
 * Как показывать интерфейс.
 *
 * `canvas` — макетное полотно 1920×1080, ужатое под окно целиком: координаты блоков
 * совпадают с Figma, прокрутки нет. Так интерфейс и задумывался.
 *
 * `stacked` — обычный поток: блоки идут сверху вниз по ширине окна, страница
 * прокручивается. Нужен там, где полотно пришлось бы ужать до нечитаемого: на телефоне
 * коэффициент выходит около 0.2, и весь экран превращается в неразличимую полоску.
 */
export type ViewportMode = 'canvas' | 'stacked';

/**
 * Ниже этого коэффициента полотно перестаёт читаться.
 *
 * 0.62 — не круглое число из головы: при нём базовый шрифт макета 16px даёт около 10px
 * на экране, что ещё разбирается, а всё, что меньше, уже нет. Порогу по коэффициенту, а
 * не по ширине окна, отдано предпочтение потому, что полотно ужимается и по высоте:
 * широкое, но низкое окно ломается ровно так же.
 */
export const MIN_CANVAS_SCALE = 0.62;

/**
 * Предельная ширина содержимого в потоке. На телефоне это вся ширина окна, на планшете
 * страница раскладывается сеткой в две колонки, а шире 1180 полотно уже читается и
 * поток не включается.
 */
export const STACK_MAX_WIDTH = 1180;

/** Поля колонки в потоке с каждой стороны. */
export const STACK_GUTTER = 16;

export function modeFor(width: number, height: number): ViewportMode {
  return scaleFor(width, height) >= MIN_CANVAS_SCALE ? 'canvas' : 'stacked';
}

export interface Viewport {
  mode: ViewportMode;
  /** Сколько пикселей доступно блоку: ширина полотна либо ширина колонки в потоке. */
  contentWidth: number;
}

export const ViewportContext = createContext<Viewport>({
  mode: 'canvas',
  contentWidth: CANVAS_WIDTH,
});

export function useViewport(): Viewport {
  return useContext(ViewportContext);
}

/** Короткая форма для ветвлений в разметке. */
export function useStacked(): boolean {
  return useViewport().mode === 'stacked';
}
