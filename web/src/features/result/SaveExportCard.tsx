import { useCallback, useState } from 'react';
import { ChevronRight, Download, History, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { variantExportPath } from '@/api/projects';
import { runEvidencePackPath, runExportPath } from '@/api/runs';
import type { Run, RoutingPolicy, Variant } from '@/api/types';
import { COMPARISON_PATH, sectionHref } from '@/app/sections';
import { useStacked } from '@/app/viewport-mode';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';
import { downloadFile, exportFileName } from '@/lib/download';
import { ROUTING_POLICIES, policyLabel } from '@/lib/run-format';
import { describe } from '@/lib/use-resource';
import { publicPath } from '@/lib/public-path';

/**
 * Подпись маскота по статусу. «Отличный результат!» над ещё идущим или упавшим расчётом
 * противоречила соседнему блоку прогресса.
 */
const MASCOT_CAPTION: Record<Run['status'], readonly [string, string]> = {
  succeeded: ['Отличный', 'результат!'],
  queued: ['Ждём', 'очереди…'],
  running: ['Ещё', 'считаем…'],
  failed: ['Попробуем', 'ещё раз'],
  cancelled: ['Расчёт', 'отменён'],
};

const LEFT = 1373;
const TOP = 112;

interface SaveExportCardProps {
  run: Run;
  variant: Variant | null;
  /** Проект известен через вариант запуска и приходит `null`, пока тот не загрузился. */
  projectId: string | null;
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
export function SaveExportCard({
  run,
  variant,
  projectId,
  projectTitle,
  recompute,
}: SaveExportCardProps) {
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

  const stacked = useStacked();
  const message = downloadError ?? recompute.error;
  // Карточка на полотне: 500 пикселей. Блок под маскотом поднят на 10 против макета —
  // иначе ссылка на сравнение ложилась на нижнюю рамку карточки.
  const at = (canvas: string, flow = '') => (stacked ? flow : `absolute ${canvas}`);

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={
        stacked
          ? 'flex h-full flex-col gap-[12px] p-[20px]'
          : 'absolute left-[1373px] top-[112px] h-[500px] w-[508px]'
      }
    >
      <div className={stacked ? 'flex items-center gap-[8px]' : 'contents'}>
        <img
          src={publicPath('assets/mascot-success.png')}
          alt=""
          aria-hidden="true"
          className={cx(
            'object-contain',
            at('left-[9px] top-[11px] h-[127px] w-[190px]', 'h-[96px] w-[144px] shrink-0'),
          )}
        />
        <p
          className={cx(
            'rotate-6 font-script font-bold leading-[1.12] tracking-[0.4px] text-ink-secondary',
            at('left-[207px] top-[52px] w-[130px] text-[26px]', 'text-[22px]'),
          )}
        >
          {MASCOT_CAPTION[run.status][0]}
          <br />
          {MASCOT_CAPTION[run.status][1]}
        </p>
      </div>

      <div className={stacked ? 'flex flex-col gap-[6px]' : 'contents'}>
        <p className={cx('text-[10px] tracking-[0.8px] text-ink-secondary', at('left-[23px] top-[149px]'))}>
          НАЗВАНИЕ ВАРИАНТА
        </p>
        <p
          className={cx(
            'flex h-[50px] items-center rounded-lg border border-line bg-surface-input px-[21px] font-semibold text-ink-primary',
            at('left-[23px] top-[167px] w-[462px] text-title-l', 'text-title-m'),
          )}
          title={variant?.title ?? 'Название варианта задаётся при его сохранении: менять его на этом экране API не позволяет'}
        >
          <span className="min-w-0 truncate">{variant?.title ?? '…'}</span>
        </p>
      </div>

      <p
        className={cx(
          'flex min-h-[22px] items-center gap-[10px] text-[15px] font-bold text-ink-primary',
          at('left-[25px] top-[229px] w-[460px]'),
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'size-[12px] shrink-0 rounded-pill',
            succeeded ? 'bg-status-success' : 'bg-status-neutral',
          )}
        />
        <span className="truncate" title={variant?.title}>
          {variant === null ? 'Загружаем вариант' : `Расчёт привязан к варианту «${variant.title}»`}
        </span>
      </p>

      <div className={stacked ? 'flex flex-col gap-[4px]' : 'contents'}>
        <PrimaryAction
          className={at('left-[23px] top-[265px] h-[48px] w-[462px]', 'h-[48px] w-full')}
          disabled={!succeeded}
          onClick={() => {
            save(runExportPath(run.id), resultName);
          }}
          icon={<Download aria-hidden="true" className="size-[18px] shrink-0" />}
          after={<ChevronRight aria-hidden="true" className="size-[16px] shrink-0" />}
        >
          Скачать результат JSON
        </PrimaryAction>

        <p
          className={cx('truncate font-mono text-[11px] text-ink-muted', at('left-[23px] top-[319px] w-[462px]'))}
          title={resultName}
        >
          {resultName}
        </p>
      </div>

      <div className={stacked ? 'grid grid-cols-2 gap-[12px]' : 'contents'}>
        <SecondaryAction
          className={at('left-[23px] top-[341px] h-[48px] w-[224px]', 'h-[48px] min-w-0 px-[12px]')}
          disabled={!succeeded}
          onClick={() => {
            save(runEvidencePackPath(run.id), packName);
          }}
          icon={<Package aria-hidden="true" className="size-[16px] shrink-0" />}
        >
          Evidence Pack
        </SecondaryAction>

        <PrimaryAction
          className={at('left-[261px] top-[341px] h-[48px] w-[224px]', 'h-[48px] min-w-0 px-[12px]')}
          compact={stacked}
          disabled={variant === null}
          onClick={() => {
            if (variant !== null) {
              save(variantExportPath(variant.id), scenarioName);
            }
          }}
          icon={<Download aria-hidden="true" className="size-[16px] shrink-0" />}
        >
          Сценарий JSON
        </PrimaryAction>
      </div>

      <div
        className={cx(
          'flex min-h-[48px] items-center rounded-[13px] border border-[var(--border-accent)] bg-[var(--surface-accent-soft)]',
          at('left-[23px] top-[401px] h-[48px] w-[462px]'),
        )}
      >
        <button
          type="button"
          disabled={variant === null || recompute.progressLabel !== null}
          onClick={recompute.onStart}
          className={cx(
            'flex min-h-[48px] min-w-0 flex-1 items-center gap-[10px] self-stretch rounded-l-[13px] pl-[15px] text-left text-[13px] font-semibold leading-[1.2] text-ink-primary transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45',
          )}
        >
          <History aria-hidden="true" className="size-[16px] shrink-0" />
          {/* В узкой колонке подпись переносится на вторую строку, а не обрезается. */}
          <span
            className={stacked ? 'line-clamp-2' : 'truncate'}
            title={recompute.progressLabel ?? 'Пересчитать с другой политикой'}
          >
            {recompute.progressLabel ?? 'Пересчитать с другой политикой'}
          </span>
        </button>
        <Select
          label="Политика маршрутизации для нового расчёта"
          className="mr-[12px] shrink-0"
          value={recompute.policy}
          disabled={recompute.progressLabel !== null}
          onChange={(value) => {
            recompute.onPolicyChange(value as RoutingPolicy);
          }}
          options={ROUTING_POLICIES.map((policy) => ({
            value: policy,
            title: policyLabel(policy),
          }))}
          triggerClassName={cx(
            'rounded-sm border border-transparent pl-[10px] pr-[6px] text-caption font-semibold text-accent-violet-light hover:border-line',
            stacked ? 'h-[40px] w-[120px]' : 'h-[34px] w-[136px]',
          )}
          menuAlign="end"
          menuWidth={196}
        />
      </div>

      {message !== null && (
        // Сообщение встаёт под строкой пересчёта, а не поверх неё. На полотне у него одна
        // строка, и полный текст остаётся во всплывающей подсказке.
        <p
          role="alert"
          title={message}
          className={cx(
            'text-[12px] text-status-danger',
            at('left-[23px] top-[453px] line-clamp-1 w-[462px]'),
          )}
        >
          {message}
        </p>
      )}

      {/* Сравнению нужен проект: без него оно не знает, среди каких вариантов выбирать. */}
      {projectId !== null && (
        <Link
          to={`${sectionHref(COMPARISON_PATH, projectId)}&runs=${run.id}`}
          className={cx(
            'inline-flex items-center gap-[4px] text-[13px] font-semibold text-accent-blue hover:underline',
            at('left-[23px] top-[471px]', 'min-h-[40px] self-start'),
          )}
        >
          Перейти к сравнению вариантов
          <ChevronRight aria-hidden="true" className="size-[14px]" />
        </Link>
      )}
    </Card>
  );
}

function PrimaryAction({
  className,
  disabled,
  onClick,
  icon,
  after,
  compact = false,
  children,
}: {
  className: string;
  /** Половина строки узкой колонки: 15 пикселей обрезали бы подпись. */
  compact?: boolean;
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
        'flex items-center rounded-lg bg-accent-magenta text-left font-semibold text-ink-onAccent shadow-glow-magenta',
        compact ? 'gap-[8px] text-[13px]' : 'gap-[12px] px-[16px] text-[15px]',
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
