import { AlertCircle, Check, Clock, Download, GitCompare, RotateCw, SquareArrowOutUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Run } from '@/api/types';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import {
  DASH,
  formatHash,
  formatRunDuration,
  formatShare,
  formatShortMoment,
  policyLabel,
  runStatusLabel,
} from '@/lib/run-format';

const LEFT = 25;
const TOP = 640;

/** Колонки макета 149:1218…149:1226. */
const COLUMNS = {
  run: 23,
  variant: 139,
  policy: 429,
  started: 579,
  duration: 759,
  availability: 899,
  hash: 1039,
  status: 1289,
  actions: 1469,
} as const;

export interface RunRowView {
  readonly run: Run;
  readonly variantLabel: string;
  readonly minAvailability: number | null;
}

interface RunsCardProps {
  /** Загрузку и ошибку показывает экран: источник у всех трёх карточек общий. */
  rows: readonly RunRowView[];
  /** Сколько последних прогонов отдаёт `GET /api/projects/{id}`: подпись честна только так. */
  limit: number;
  onOpen: (row: RunRowView) => void;
  onEvidencePack: (row: RunRowView) => void;
  onCompare: (row: RunRowView) => void;
  onRepeat: (row: RunRowView) => void;
  repeatDisabled: boolean;
}

/** Card / Прогоны (149:1214): `recent_runs` из `GET /api/projects/{id}`. */
export function RunsCard({
  rows,
  limit,
  onOpen,
  onEvidencePack,
  onCompare,
  onRepeat,
  repeatDisabled,
}: RunsCardProps) {
  const latest = rows[0]?.run.started_at ?? null;

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[25px] top-[640px] h-[416px] w-[1870px]"
    >
      <h2 className="absolute left-[23px] top-[17px] text-title-m font-semibold text-ink-primary">
        Прогоны
      </h2>
      {rows.length > 0 && (
        <p className="absolute left-[131px] top-[23px] text-caption text-ink-secondary">
          {rows.length} прогонов
          {latest === null ? '' : ` · последний ${formatShortMoment(latest)}`}
        </p>
      )}
      {/* В макете здесь ссылка «Показать все ›». Отдельного экрана прогонов в
          `14_SCREENS.md` нет, а `GET /api/projects/{id}` отдаёт последние 20 и весь
          список внутри карточки прокручивается — ссылке некуда вести. */}
      {rows.length >= limit && (
        <p className="absolute left-[1645px] top-[23px] w-[200px] text-right text-caption text-ink-muted">
          показаны последние {limit}
        </p>
      )}

      <div className="absolute left-[23px] top-[61px] h-[14px] w-[1822px] text-[9px] font-semibold uppercase tracking-[0.54px] text-ink-muted">
        <Head left={COLUMNS.run}>Прогон</Head>
        <Head left={COLUMNS.variant}>Вариант</Head>
        <Head left={COLUMNS.policy}>Политика</Head>
        <Head left={COLUMNS.started}>Запущен</Head>
        <Head left={COLUMNS.duration}>Длительность</Head>
        <Head left={COLUMNS.availability}>min дост.</Head>
        <Head left={COLUMNS.hash}>config_hash</Head>
        <Head left={COLUMNS.status}>Статус</Head>
        <Head left={COLUMNS.actions}>Действия</Head>
      </div>
      <div aria-hidden="true" className="absolute left-[23px] top-[79px] h-px w-[1822px] bg-line-divider" />

      <div className="absolute left-[17px] top-[87px] h-[306px] w-[1840px]">
        {rows.length === 0 && (
          <EmptyState
            title="Расчётов ещё нет"
            hint="Запустите расчёт кнопкой «Рассчитать» в строке варианта — он появится здесь со статусом и длительностью."
          />
        )}

        {rows.length > 0 && (
          <ul className="scroll-area h-full w-[1846px]">
            {rows.map((row, index) => (
              <li
                key={row.run.id}
                className="relative h-[44px] rounded-[9px] text-[13px]"
                style={{
                  backgroundColor: index % 2 === 1 ? 'var(--surface-row-stripe)' : undefined,
                }}
              >
                <Cell left={COLUMNS.run} width={110} className="font-mono text-[12px] text-ink-secondary">
                  <span title={row.run.id}>run_{row.run.id.slice(0, 4)}</span>
                </Cell>
                <Cell left={COLUMNS.variant} width={280} className="text-[14px] font-semibold text-ink-primary">
                  <span className="truncate">{row.variantLabel}</span>
                </Cell>
                <Cell left={COLUMNS.policy} width={140} className="font-medium text-ink-secondary">
                  {policyLabel(row.run.routing_policy)}
                </Cell>
                <Cell left={COLUMNS.started} width={170} className="font-medium text-ink-secondary">
                  {row.run.started_at == null ? DASH : formatShortMoment(row.run.started_at)}
                </Cell>
                <Cell left={COLUMNS.duration} width={130} className="font-medium text-ink-secondary">
                  {row.run.duration_ms == null ? DASH : formatRunDuration(row.run.duration_ms)}
                </Cell>
                <Cell
                  left={COLUMNS.availability}
                  width={130}
                  className="text-[14px] font-semibold text-ink-primary"
                >
                  {row.minAvailability === null ? (
                    <span className="text-ink-muted">{DASH}</span>
                  ) : (
                    formatShare(row.minAvailability)
                  )}
                </Cell>
                <Cell left={COLUMNS.hash} width={240} className="font-mono text-[12px] text-ink-muted">
                  <span title={row.run.config_hash}>{formatHash(row.run.config_hash)}</span>
                </Cell>
                <Cell left={COLUMNS.status} width={170} className="font-semibold">
                  <StatusCell run={row.run} />
                </Cell>

                <span className="absolute top-[7px] flex gap-[8px]" style={{ left: COLUMNS.actions - 17 }}>
                  <RowAction
                    label="Открыть результат"
                    icon={<SquareArrowOutUpRight aria-hidden="true" className="size-[16px]" />}
                    onClick={() => {
                      onOpen(row);
                    }}
                  />
                  <RowAction
                    label="Скачать Evidence Pack"
                    icon={<Download aria-hidden="true" className="size-[16px]" />}
                    disabled={row.run.status !== 'succeeded'}
                    onClick={() => {
                      onEvidencePack(row);
                    }}
                  />
                  <RowAction
                    label="В сравнение"
                    icon={<GitCompare aria-hidden="true" className="size-[16px]" />}
                    disabled={row.run.status !== 'succeeded'}
                    onClick={() => {
                      onCompare(row);
                    }}
                  />
                  <RowAction
                    label="Повторить расчёт"
                    icon={<RotateCw aria-hidden="true" className="size-[16px]" />}
                    disabled={repeatDisabled}
                    onClick={() => {
                      onRepeat(row);
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * У неудавшегося запуска сообщение сервиса уходит в подсказку статуса: отдельного экрана
 * лога в `14_SCREENS.md` нет, а `error.message` — единственное, что API про отказ знает.
 */
function StatusCell({ run }: { run: Run }) {
  if (run.status === 'succeeded') {
    return (
      <span className="flex items-center gap-[7px] text-status-success">
        <Check aria-hidden="true" className="size-[13px]" />
        {runStatusLabel(run.status)}
      </span>
    );
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    return (
      <span
        className="flex items-center gap-[7px] text-status-danger"
        title={run.error?.message ?? 'Сервис не сообщил причину'}
      >
        <AlertCircle aria-hidden="true" className="size-[13px]" />
        {runStatusLabel(run.status)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[7px] text-accent-blue">
      <Clock aria-hidden="true" className="size-[13px]" />
      {runStatusLabel(run.status)}
    </span>
  );
}

function Head({ left, children }: { left: number; children: ReactNode }) {
  return (
    <span className="absolute" style={{ left: left - COLUMNS.run }}>
      {children}
    </span>
  );
}

function Cell({
  left,
  width,
  className,
  children,
}: {
  left: number;
  width: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx('absolute top-[14px] flex items-center overflow-hidden', className)}
      style={{ left: left - 17, width }}
    >
      {children}
    </span>
  );
}

function RowAction({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-[30px] items-center justify-center rounded-sm border border-line text-accent-blue transition-colors duration-150 hover:border-line-strong hover:bg-[var(--surface-row-active)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}
