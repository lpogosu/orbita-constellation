import { useCallback, useState } from 'react';
import { ChevronRight, Download, History, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { variantExportPath } from '@/api/projects';
import { runEvidencePackPath, runExportPath } from '@/api/runs';
import type { Run, RoutingPolicy, Variant } from '@/api/types';
import { COMPARISON_PATH } from '@/app/sections';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { downloadFile, exportFileName } from '@/lib/download';
import { ROUTING_POLICIES, policyLabel } from '@/lib/run-format';
import { describe } from '@/lib/use-resource';

const LEFT = 1373;
const TOP = 112;

interface SaveExportCardProps {
  run: Run;
  variant: Variant | null;
  projectTitle: string | null;
  /** Пересчёт с другой политикой: карточка отдаёт выбор, ожиданием управляет экран. */
  recompute: {
    readonly policy: RoutingPolicy;
    readonly onPolicyChange: (policy: RoutingPolicy) => void;
    readonly onStart: () => void;
    /** Текст на кнопке, пока идёт новый расчёт; `null` — кнопка свободна. */
    readonly progressLabel: string | null;
    readonly error: string | null;
  };
}

/**
 * Card / Save & Export (51:688). Название варианта только для чтения: `PATCH` варианта в
 * `05_API.md` §2 нет, а поле с курсором, которое ничего не сохраняет, хуже подписи.
 */
export function SaveExportCard({ run, variant, projectTitle, recompute }: SaveExportCardProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const succeeded = run.status === 'succeeded';

  const baseName = [
    projectTitle ?? 'orbita',
    variant?.title ?? 'variant',
    policyLabel(run.routing_policy),
  ];
  const resultName = exportFileName(baseName, 'json');
  const scenarioName = exportFileName([...baseName.slice(0, 2), 'scenario'], 'json');
  const packName = exportFileName(baseName, 'zip');

  const save = useCallback((path: string, fileName: string) => {
    setDownloadError(null);
    void downloadFile(path, fileName).catch((error: unknown) => {
      setDownloadError(describe(error));
    });
  }, []);

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[1373px] top-[112px] h-[500px] w-[508px]"
    >
      <img
        src="/assets/mascot-success.png"
        alt=""
        aria-hidden="true"
        className="absolute left-[9px] top-[11px] h-[127px] w-[190px] object-contain"
      />
      <p className="absolute left-[207px] top-[52px] w-[130px] rotate-6 font-script text-[26px] font-bold leading-[1.12] tracking-[0.4px] text-ink-secondary">
        Отличный
        <br />
        результат!
      </p>

      <p className="absolute left-[23px] top-[159px] text-[10px] tracking-[0.8px] text-ink-secondary">
        НАЗВАНИЕ ВАРИАНТА
      </p>
      <p
        className="absolute left-[23px] top-[177px] flex h-[50px] w-[462px] items-center truncate rounded-lg border border-line bg-surface-input px-[21px] text-title-l font-semibold text-ink-primary"
        title="Название варианта задаётся при его сохранении: менять его на этом экране API не позволяет"
      >
        {variant?.title ?? '…'}
      </p>

      <p className="absolute left-[25px] top-[239px] flex items-center gap-[10px] text-[15px] font-bold text-ink-primary">
        <span
          aria-hidden="true"
          className={cx(
            'size-[12px] rounded-pill',
            succeeded ? 'bg-status-success' : 'bg-status-neutral',
          )}
        />
        {variant === null ? 'Загружаем вариант' : `Расчёт привязан к варианту «${variant.title}»`}
      </p>

      <PrimaryAction
        className="absolute left-[23px] top-[275px] h-[48px] w-[462px]"
        disabled={!succeeded}
        onClick={() => {
          save(runExportPath(run.id), resultName);
        }}
        icon={<Download aria-hidden="true" className="size-[18px]" />}
        after={<ChevronRight aria-hidden="true" className="size-[16px]" />}
      >
        Скачать результат JSON
      </PrimaryAction>

      <p className="absolute left-[23px] top-[329px] w-[462px] truncate font-mono text-[11px] text-ink-muted">
        {resultName}
      </p>

      <SecondaryAction
        className="absolute left-[23px] top-[351px] h-[48px] w-[224px]"
        disabled={!succeeded}
        onClick={() => {
          save(runEvidencePackPath(run.id), packName);
        }}
        icon={<Package aria-hidden="true" className="size-[16px]" />}
      >
        Evidence Pack
      </SecondaryAction>

      <PrimaryAction
        className="absolute left-[261px] top-[351px] h-[48px] w-[224px]"
        disabled={variant === null}
        onClick={() => {
          if (variant !== null) {
            save(variantExportPath(variant.id), scenarioName);
          }
        }}
        icon={<Download aria-hidden="true" className="size-[16px]" />}
      >
        Сценарий JSON
      </PrimaryAction>

      <div className="absolute left-[23px] top-[411px] flex h-[48px] w-[462px] items-center rounded-[13px] border border-[var(--border-accent)] bg-[var(--surface-accent-soft)]">
        <button
          type="button"
          disabled={variant === null || recompute.progressLabel !== null}
          onClick={recompute.onStart}
          className="flex h-full flex-1 items-center gap-[10px] rounded-l-[13px] pl-[15px] text-left text-[13px] font-semibold text-ink-primary transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <History aria-hidden="true" className="size-[16px]" />
          {recompute.progressLabel ?? 'Пересчитать с другой политикой'}
        </button>
        <label className="flex h-full items-center pr-[12px]">
          <span className="sr-only">Политика маршрутизации для нового расчёта</span>
          <select
            value={recompute.policy}
            onChange={(event) => {
              recompute.onPolicyChange(event.target.value as RoutingPolicy);
            }}
            disabled={recompute.progressLabel !== null}
            className="cursor-pointer rounded-sm bg-transparent py-[4px] text-[12px] font-semibold text-accent-violet-light disabled:cursor-not-allowed disabled:opacity-45"
          >
            {ROUTING_POLICIES.map((policy) => (
              <option key={policy} value={policy} className="bg-surface-raised text-ink-primary">
                {policyLabel(policy)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(downloadError ?? recompute.error) !== null && (
        <p role="alert" className="absolute left-[23px] top-[437px] w-[462px] text-[12px] text-status-danger">
          {downloadError ?? recompute.error}
        </p>
      )}

      <Link
        to={`${COMPARISON_PATH}?runs=${run.id}`}
        className="absolute left-[23px] top-[467px] inline-flex items-center gap-[4px] text-[13px] font-semibold text-accent-blue hover:underline"
      >
        Перейти к сравнению вариантов
        <ChevronRight aria-hidden="true" className="size-[14px]" />
      </Link>
    </Card>
  );
}

function PrimaryAction({
  className,
  disabled,
  onClick,
  icon,
  after,
  children,
}: {
  className: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  after?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex items-center gap-[12px] rounded-lg bg-accent-magenta px-[16px] text-left text-[15px] font-semibold text-ink-onAccent shadow-glow-magenta',
        'transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100',
        className,
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {after}
    </button>
  );
}

function SecondaryAction({
  className,
  disabled,
  onClick,
  icon,
  children,
}: {
  className: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex items-center gap-[10px] rounded-[13px] border border-line bg-surface-raised px-[15px] text-left text-[13px] font-semibold text-ink-primary',
        'transition-colors duration-150 hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
    </button>
  );
}
