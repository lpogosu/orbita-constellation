import { AlertTriangle, Inbox, Lock, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { cx } from '@/lib/cx';

/**
 * Четыре обязательных состояния блока (14_SCREENS.md §0.4): загрузка, пусто, ошибка и
 * недоступно. Они живут вместе, чтобы ни один экран не изобретал пятое.
 */

/** Скелетон повторяет форму будущего содержимого, а не крутится в центре блока. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx('animate-pulse rounded-sm bg-surface-chip', className)}
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
}: {
  title: string;
  hint: string;
  icon?: ReactNode;
}) {
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
}: {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
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
export function UnavailableBlock({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-4 text-center opacity-70">
      <Lock aria-hidden="true" className="size-6 text-ink-muted" />
      <p className="text-title-m font-semibold text-ink-primary">{title}</p>
      <p className="max-w-[52ch] text-small text-ink-secondary">{hint}</p>
    </div>
  );
}
