import type { CSSProperties, ReactNode } from 'react';

import { useViewport } from '@/app/viewport-mode';
import type { Box } from './box';

interface SlotProps {
  box: Box;
  children: ReactNode;
  className?: string;
  /** Классы, которые нужны блоку только в потоке: например, место в сетке планшета. */
  stackedClassName?: string;
  style?: CSSProperties;
}

/**
 * Блок экрана, позицию которого задаёт страница.
 *
 * На полотне ставит его по макетным координатам тем же `position: absolute`, что и до
 * появления потока. В потоке координаты теряют смысл: блок становится элементом
 * колонки или сетки страницы.
 */
export function Slot({ box, children, className, stackedClassName, style }: SlotProps) {
  const { mode } = useViewport();

  if (mode === 'canvas') {
    return (
      <div
        className={className ? `absolute ${className}` : 'absolute'}
        style={{ left: box.x, top: box.y, ...style }}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={[className, stackedClassName].filter(Boolean).join(' ') || undefined} style={style}>
      {children}
    </div>
  );
}

/**
 * Обёртка содержимого экрана.
 *
 * На полотне не добавляет ничего — страница остаётся набором блоков с макетными
 * координатами. В потоке превращает её в колонку с полями; раскладку внутри колонки
 * (одна колонка на телефоне, две на планшете) страница задаёт через `className`.
 */
export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  const { mode } = useViewport();

  if (mode === 'canvas') {
    return <>{children}</>;
  }

  return <div className={className ? `page-stack ${className}` : 'page-stack'}>{children}</div>;
}

/**
 * Корень экрана, у которого на полотне свои классы (`absolute inset-0`).
 *
 * На полотне — тот же контейнер. В потоке — колонка `page-stack`.
 */
export function PageRoot({
  children,
  canvasClassName,
  className,
}: {
  children: ReactNode;
  canvasClassName: string;
  className?: string;
}) {
  const { mode } = useViewport();

  if (mode === 'canvas') {
    return <div className={canvasClassName}>{children}</div>;
  }

  return <div className={className ? `page-stack ${className}` : 'page-stack'}>{children}</div>;
}

/**
 * Блок, который несёт свои координаты сам (`absolute left-[44px] top-[124px]`).
 *
 * На полотне не добавляет ничего. В потоке — обычная обёртка: раскладку содержимого
 * в потоке компонент задаёт сам через `useStacked()`.
 */
export function Block({ children, className }: { children: ReactNode; className?: string }) {
  const { mode } = useViewport();

  if (mode === 'canvas') {
    return <>{children}</>;
  }

  return <div className={className ?? 'w-full'}>{children}</div>;
}
