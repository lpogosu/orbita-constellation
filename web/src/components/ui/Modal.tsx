import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { cx } from '@/lib/cx';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: string;
  subtitle?: ReactNode;
  /** Иллюстрация над заголовком: в макете она выступает за верхний край окна. */
  hero?: ReactNode;
  /**
   * Выравнивание шапки и ряда действий. По центру — окно ошибок сценария (узел `65:646`),
   * по левому краю — окна работы с параметрами (узел `133:1628`).
   */
  align?: 'center' | 'start';
  width?: number;
  /**
   * Тело окна прокручивается. Окну, внутри которого раскрывается выпадающий список,
   * прокрутка не нужна: она обрезала бы панель списка по своему краю.
   */
  scrollBody?: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}

/**
 * Модал макета: затемнение, стеклянная карточка, центрированная шапка и ряд действий
 * внизу. Фокус не уходит за пределы окна — иначе клавиатурный пользователь продолжает
 * табом по экрану, который для него закрыт.
 */
export function Modal({
  title,
  subtitle,
  hero,
  align = 'center',
  width = 880,
  scrollBody = true,
  onClose,
  footer,
  children,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);

  const trapFocus = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Tab' || dialog.current === null) {
      return;
    }
    const targets = dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      trapFocus(event);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, [onClose, trapFocus]);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(4,8,26,0.72)] px-6 py-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card-glass relative w-full border-line-strong px-8 pb-8 pt-6"
        style={{ maxWidth: width }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть окно"
          className="absolute right-6 top-6 rounded-sm p-1.5 text-ink-muted transition-colors duration-150 hover:text-ink-primary"
        >
          <X aria-hidden="true" className="size-5" />
        </button>

        {hero !== undefined && <div className="-mt-24 flex justify-center">{hero}</div>}

        <h2
          className={cx(
            'text-heading-m font-bold text-ink-primary',
            align === 'center' && 'text-center',
          )}
        >
          {title}
        </h2>
        {subtitle !== undefined && (
          <p className={cx('mt-2 text-base text-ink-secondary', align === 'center' && 'text-center')}>
            {subtitle}
          </p>
        )}

        <div className={cx('mt-6', scrollBody && 'scroll-area max-h-[420px] pr-2')}>{children}</div>

        <div
          className={cx(
            'mt-7 flex flex-wrap gap-4',
            align === 'center' ? 'justify-center' : 'justify-between',
          )}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
