import type { HTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

/**
 * Стеклянная карточка макета: ночная сцена под тонировкой, рамка, радиус 24 и тень
 * Elevation/Card. Тонировка и сцена — токены, поэтому в светлой теме остаётся ровный фон.
 */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'card-scenery relative overflow-hidden rounded-2xl border border-line shadow-card',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
