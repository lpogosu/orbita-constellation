import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  Clock,
  Database,
  History,
  Loader,
  Settings,
  Share2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { Run, Variant } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { Skeleton } from '@/components/state/States';
import { cx } from '@/lib/cx';
import {
  formatHash,
  formatHorizon,
  formatRunDuration,
  formatUtcMoment,
  policyLabel,
  runStatusLabel,
} from '@/lib/run-format';

interface StatusView {
  readonly title: string;
  readonly ring: string;
  readonly icon: ReactNode;
}

const STATUS: Record<Run['status'], StatusView> = {
  queued: {
    title: 'Расчёт в очереди',
    ring: 'border-accent-blue text-accent-blue',
    icon: <Clock aria-hidden="true" className="size-[42px]" />,
  },
  running: {
    title: 'Расчёт ещё идёт',
    ring: 'border-accent-blue text-accent-blue',
    icon: <Loader aria-hidden="true" className="size-[42px] animate-spin" />,
  },
  succeeded: {
    title: 'Расчёт завершён',
    ring: 'border-status-success text-status-success',
    icon: <Check aria-hidden="true" className="size-[42px]" />,
  },
  failed: {
    title: 'Расчёт не удался',
    ring: 'border-status-danger text-status-danger',
    icon: <AlertTriangle aria-hidden="true" className="size-[42px]" />,
  },
  cancelled: {
    title: 'Расчёт отменён',
    ring: 'border-status-neutral text-status-neutral',
    icon: <Ban aria-hidden="true" className="size-[42px]" />,
  },
};

interface ResultHeaderProps {
  run: Run;
  variant: Variant | null;
}

/** Кольцо статуса (49:586), заголовок (49:589), подзаголовок (49:590) и «Meta» (49:591). */
export function ResultHeader({ run, variant }: ResultHeaderProps) {
  const stacked = useStacked();
  const status = STATUS[run.status];
  const environment = variant?.scenario.environment;
  const subtitle = variant?.title ?? runStatusLabel(run.status);

  const chips = (
    <>
      <Chip icon={<Share2 aria-hidden="true" className="size-[14px]" />}>
        {policyLabel(run.routing_policy)}
      </Chip>
      <Chip icon={<Settings aria-hidden="true" className="size-[14px]" />}>
        {run.engine_version}
      </Chip>
      <Chip
        icon={<Database aria-hidden="true" className="size-[14px]" />}
        hint={`config_hash ${run.config_hash}`}
      >
        config_hash {formatHash(run.config_hash)}
      </Chip>
      <Chip icon={<Clock aria-hidden="true" className="size-[14px]" />}>
        {environment === undefined ? (
          <Skeleton className="h-[12px] w-[160px]" />
        ) : (
          `${formatHorizon(environment.horizon_s)} · шаг ${String(environment.step_s)} с · ${String(run.total_ticks)} отсчётов`
        )}
      </Chip>
      {run.finished_at !== null && run.finished_at !== undefined && (
        <Chip icon={<Calendar aria-hidden="true" className="size-[14px]" />}>
          {formatUtcMoment(run.finished_at)}
        </Chip>
      )}
      <Chip
        icon={<History aria-hidden="true" className="size-[14px]" />}
        hint={`Идентификатор запуска: ${run.id}`}
      >
        {run.duration_ms === null || run.duration_ms === undefined
          ? `отсчётов ${String(run.completed_ticks)} из ${String(run.total_ticks)}`
          : `расчёт ${formatRunDuration(run.duration_ms)}`}{' '}
        · run_{run.id.slice(0, 4)}
      </Chip>
    </>
  );

  if (stacked) {
    return (
      <header className="flex flex-col gap-[16px] pt-[8px]">
        <div className="flex items-center gap-[16px]">
          <div
            className={cx(
              'flex size-[56px] shrink-0 items-center justify-center rounded-pill border-2 md:size-[72px] [&>svg]:size-[28px] md:[&>svg]:size-[36px]',
              status.ring,
            )}
          >
            {status.icon}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-title-l font-bold text-ink-primary md:text-heading-m">
              {status.title}
            </h1>
            <p className="truncate text-small text-ink-secondary md:text-title-m" title={subtitle}>
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-[8px]">{chips}</div>
      </header>
    );
  }

  return (
    <>
      <div
        className={cx(
          'absolute left-[43px] top-[127px] flex size-[84px] items-center justify-center rounded-pill border-2',
          status.ring,
        )}
      >
        {status.icon}
      </div>

      <h1 className="absolute left-[158px] top-[126px] font-display text-[40px] font-bold leading-[48px] text-ink-primary">
        {status.title}
      </h1>

      <p
        className="absolute left-[160px] top-[178px] w-[380px] truncate text-title-l leading-[34px] text-ink-secondary"
        title={subtitle}
      >
        {subtitle}
      </p>

      <div className="absolute left-[560px] top-[132px] flex w-[790px] flex-wrap gap-x-[10px] gap-y-[8px]">
        {chips}
      </div>
    </>
  );
}

function Chip({
  icon,
  hint,
  children,
}: {
  icon: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="flex h-[27px] max-w-full items-center gap-[7px] rounded-[8px] border border-line bg-surface-sunken pl-[11px] pr-[13px] text-[12px] font-medium leading-[15px] text-ink-secondary"
      title={hint}
    >
      <span className="shrink-0 text-ink-muted">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
