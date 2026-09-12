import { AlertCircle, AlertTriangle, Inbox, Lock, RotateCw } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { cx } from '@/lib/cx';

/**
 * Четыре обязательных состояния блока (14_SCREENS.md §0.4): загрузка, пусто, ошибка и
 * недоступно. Они живут вместе, чтобы ни один экран не изобретал пятое.
 */

/** Скелетон повторяет форму будущего содержимого, а не крутится в центре блока. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cx('animate-pulse rounded-sm bg-surface-chip', className)}
      style={style}
      aria-hidden="true"
    />
  );
}

export function LoadingBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon = <Inbox aria-hidden="true" className="size-6" />,
  compact = false,
}: {
  title: string;
  hint: string;
  icon?: ReactNode;
  /** Блок в одну строку: для полос ниже 150 пикселей, где столбик обрезается краем. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex h-full items-center gap-[10px] px-[16px] text-left">
        <span className="shrink-0 text-ink-muted">{icon}</span>
        <p className="line-clamp-2 min-w-0 flex-1 text-small text-ink-secondary" title={hint}>
          <span className="font-semibold text-ink-primary">{title}. </span>
          {hint}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-4 text-center">
      <span className="text-ink-muted">{icon}</span>
      <p className="text-title-m font-semibold text-ink-primary">{title}</p>
      <p className="max-w-[46ch] text-small text-ink-secondary">{hint}</p>
    </div>
  );
}

export function ErrorBlock({
  title,
  message,
  onRetry,
  retryLabel = 'Повторить',
  compact = false,
  appearance = 'default',
}: {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Блок в одну строку: кнопка повтора обязана остаться видимой и в низкой полосе. */
  compact?: boolean;
  /** Компактный overlay над данными по компоненту Figma `State/Block → Error`. */
  appearance?: 'default' | 'figma';
}) {
  if (compact) {
    return (
      <div role="alert" className="flex h-full items-center gap-[10px] px-[16px] text-left">
        <AlertTriangle aria-hidden="true" className="size-5 shrink-0 text-status-danger" />
        <p className="line-clamp-2 min-w-0 flex-1 text-small text-ink-secondary" title={message}>
          <span className="font-semibold text-ink-primary">{title}. </span>
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-[6px] whitespace-nowrap rounded-sm border border-line px-[12px] py-[6px] text-caption font-semibold text-ink-primary transition-colors duration-150 hover:border-line-strong"
        >
          <RotateCw aria-hidden="true" className="size-[14px]" />
          {retryLabel}
        </button>
      </div>
    );
  }
  if (appearance === 'figma') {
    return (
      <div
        role="alert"
        className="mx-auto flex h-[230px] w-full max-w-[496px] flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <AlertCircle aria-hidden="true" className="size-[30px] text-status-danger" />
        <p className="text-small font-semibold text-ink-primary">{title}</p>
        <p className="max-w-full truncate text-caption text-status-danger" title={message}>
          {message}
        </p>
        <Button variant="secondary" onClick={onRetry} className="mt-1 w-[240px] rounded-[15px]">
          {retryLabel}
        </Button>
      </div>
    );
  }
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 py-4 text-center">
      <AlertTriangle aria-hidden="true" className="size-6 text-status-danger" />
      <p className="text-title-m font-semibold text-ink-primary">{title}</p>
      <p className="max-w-[46ch] text-small text-ink-secondary">{message}</p>
      <Button
        variant="secondary"
        onClick={onRetry}
        icon={<RotateCw aria-hidden="true" className="size-5" />}
      >
        {retryLabel}
      </Button>
    </div>
  );
}

/** Блок затемнён и объясняет, чего не хватает; кнопок здесь нет намеренно. */
export function UnavailableBlock({
  title,
  hint,
  compact = false,
}: {
  title: string;
  hint: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex h-full items-center gap-[10px] px-[16px] text-left opacity-70">
        <Lock aria-hidden="true" className="size-5 shrink-0 text-ink-muted" />
        <p className="line-clamp-2 min-w-0 flex-1 text-small text-ink-secondary" title={hint}>
          <span className="font-semibold text-ink-primary">{title}. </span>
          {hint}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-4 text-center opacity-70">
      <Lock aria-hidden="true" className="size-6 text-ink-muted" />
      <p className="text-title-m font-semibold text-ink-primary">{title}</p>
      <p className="max-w-[52ch] text-small text-ink-secondary">{hint}</p>
    </div>
  );
}
