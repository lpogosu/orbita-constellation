import { AlertTriangle, Info } from 'lucide-react';
import { forwardRef } from 'react';
import type { CSSProperties } from 'react';

import { cx } from '@/lib/cx';

/**
 * Сообщение рядом с действием: ошибка запуска, предупреждение о бюджете, отказ демо.
 *
 * Такой текст приходит из API или складывается из данных, и его длину макет не знает.
 * Обрезать его в одну строку нельзя: многоточие обычно съедает ровно ту часть, где сказано,
 * что делать. Поэтому сообщение переносится до `lines` строк, а место под него забирает у
 * соседней гибкой области — прокручиваемой середины карточки, пустой полосы над кнопкой, —
 * но не у самих кнопок. Полный текст остаётся в подсказке на случай, если и трёх строк мало.
 *
 * Названия и идентификаторы — другое дело: их многоточие допустимо, и компонент для них не
 * нужен.
 */

type Tone = 'danger' | 'warning' | 'info';

const TONE: Record<Tone, string> = {
  danger: 'text-status-danger',
  warning: 'text-status-warning',
  info: 'text-ink-secondary',
};

// Перечислены явно, а не собраны строкой: Tailwind должен найти классы в исходнике.
const CLAMP: Record<1 | 2 | 3 | 4, string> = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
};

interface InlineMessageProps {
  readonly children: string;
  readonly tone?: Tone;
  /**
   * Сколько строк сообщение занимает, прежде чем остаток уйдёт в подсказку. `all` — без
   * ограничения: в потоке высота не задана макетом, и обрезать там незачем.
   */
  readonly lines?: 1 | 2 | 3 | 4 | 'all';
  readonly className?: string;
  readonly style?: CSSProperties;
}

export const InlineMessage = forwardRef<HTMLParagraphElement, InlineMessageProps>(
  function InlineMessage({ children, tone = 'danger', lines = 3, className, style }, ref) {
    const Icon = tone === 'info' ? Info : AlertTriangle;
    return (
      <p
        ref={ref}
        role={tone === 'danger' ? 'alert' : 'status'}
        title={children}
        className={cx('flex items-start gap-[6px]', TONE[tone], className)}
        style={style}
      >
        {/* Иконка стоит на первой строке текста и растёт вместе с кеглем. */}
        <Icon aria-hidden="true" className="mt-[0.15em] size-[1.1em] shrink-0" />
        <span className={cx('min-w-0 break-words', lines !== 'all' && CLAMP[lines])}>{children}</span>
      </p>
    );
  },
);
