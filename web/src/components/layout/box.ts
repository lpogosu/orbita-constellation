import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

import { useViewport } from '@/app/viewport-mode';

/** Прямоугольник блока на макетном полотне 1920×1080. */
export interface Box {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * Размер, который блок реально может занять.
 *
 * Компонентам на canvas и WebGL нужны пиксели числом: сами они из CSS размер не берут.
 * На полотне это макетная величина, в потоке — ширина колонки и высота в той же
 * пропорции, но не выше `maxHeightRatio` окна: на телефоне в альбомной ориентации
 * карта в полную пропорцию не поместилась бы на экран.
 */
export function useBoxSize(
  box: Required<Pick<Box, 'width' | 'height'>>,
  maxHeightRatio = 0.7,
): { width: number; height: number } {
  const { mode, contentWidth } = useViewport();

  if (mode === 'canvas') {
    return { width: box.width, height: box.height };
  }

  const width = contentWidth;
  const proportional = Math.round((box.height / box.width) * width);
  const cap = Math.round(window.innerHeight * maxHeightRatio);
  return { width, height: Math.min(proportional, cap) };
}

/**
 * Раскладка карточки, которая ставит себя сама.
 *
 * Стеклянные карточки макета показывают сцену под собой: фон полотна сдвинут на их
 * позицию, поэтому за стеклом видно ровно то, что за ним и есть. В потоке позиции нет,
 * и сдвиг превратился бы в случайный кусок картинки, поэтому фон возвращается в начало,
 * а высота перестаёт быть макетной: содержимое в узкой колонке выше.
 */
export function useCardBox(box: Required<Box>): {
  positionClass: string;
  style: CSSProperties;
} {
  const { mode } = useViewport();

  if (mode === 'canvas') {
    return {
      positionClass: 'absolute',
      style: {
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        backgroundPosition: `0 0, ${-box.x}px ${-box.y}px`,
      },
    };
  }

  return {
    positionClass: 'relative',
    style: { width: '100%', backgroundPosition: '0 0, 0 0' },
  };
}

/**
 * Ширина и высота контейнера, пересчитываемые при каждом его изменении.
 *
 * В потоке карточка может занимать половину строки на планшете и всю строку на
 * телефоне, и график или canvas внутри неё должен узнать это число, а не угадывать по
 * ширине окна.
 */
export function useContainerSize<T extends HTMLElement>(): [
  RefObject<T>,
  { width: number; height: number },
] {
  // `useRef<T>(null)` даёт `RefObject<T>` — ровно тот тип, который принимает атрибут `ref`.
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const apply = (): void => {
      const next = { width: Math.round(element.clientWidth), height: Math.round(element.clientHeight) };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, size];
}
