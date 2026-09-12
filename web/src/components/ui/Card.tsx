import type { HTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Левый верхний угол карточки на полотне. Сцена под стеклом сдвигается на эту величину,
   * поэтому карточка показывает ровно тот кусок фона, который за ней, — как в макете, где
   * стекло не двигает картинку.
   */
  sceneX?: number;
  sceneY?: number;
}

/** Стеклянная карточка макета: сцена под тонировкой, рамка, радиус 24 и тень Elevation/Card. */
export function Card({ sceneX = 0, sceneY = 0, className, style, children, ...rest }: CardProps) {
  return (
    <div
      className={cx('card-glass', className)}
      style={{ backgroundPosition: `0 0, ${-sceneX}px ${-sceneY}px`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
