import {
  AlertCircle,
  Check,
  Clock,
  Download,
  GitCompare,
  RotateCw,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { Run } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
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

/**
 * Моноширинный шрифт при той же высоте строки рисует знаки выше пропорционального, и
 * хеш на общей средней линии строки стоял на 2 px выше соседних колонок. Отступ сверху
 * опускает его на общую базовую линию.
 */
const MONO_CELL = 'pt-[4px] font-mono text-[12px]';

/**
 * Ширина таблицы в потоке: до конца кнопок действий. Пустой хвост полотна справа от них
 * на телефоне только удлинил бы прокрутку вбок.
 */
const STACKED_TABLE_WIDTH = COLUMNS.actions - 17 + 4 * 40 + 3 * 8 + 8;

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
  const stacked = useStacked();

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={
        stacked ? 'pb-[12px] pt-[16px]' : 'absolute left-[25px] top-[640px] h-[416px] w-[1870px]'
      }
    >
      <div
        className={
          stacked ? 'flex flex-wrap items-baseline gap-x-[12px] gap-y-[4px] px-[20px]' : 'contents'
        }
      >
        <h2
          className={cx(
            'text-title-m font-semibold text-ink-primary',
            !stacked && 'absolute left-[23px] top-[17px]',
          )}
        >
          Прогоны
        </h2>
        {rows.length > 0 && (
          <p
            className={cx(
              'text-caption text-ink-secondary',
              !stacked && 'absolute left-[131px] top-[23px]',
            )}
          >
            {rows.length} прогонов
            {latest === null ? '' : ` · последний ${formatShortMoment(latest)}`}
          </p>
        )}
        {/* В макете здесь ссылка «Показать все ›». Отдельного экрана прогонов в
            `14_SCREENS.md` нет, а `GET /api/projects/{id}` отдаёт последние 20 и весь
            список внутри карточки прокручивается — ссылке некуда вести. */}
        {rows.length >= limit && (
          <p
            className={cx(
              'text-caption text-ink-muted',
              stacked ? 'ml-auto' : 'absolute left-[1645px] top-[23px] w-[200px] text-right',
            )}
          >
            показаны последние {limit}
          </p>
        )}
      </div>

      <div className={stacked ? 'mt-[16px] overflow-x-auto' : 'contents'}>
        <div
          className={stacked ? 'relative px-[17px]' : 'contents'}
          style={stacked ? { width: STACKED_TABLE_WIDTH + 34 } : undefined}
        >
          <div
            className={cx(
              'h-[14px] text-[9px] font-semibold uppercase tracking-[0.54px] text-ink-muted',
              stacked ? 'relative ml-[6px]' : 'absolute left-[23px] top-[61px] w-[1822px]',
            )}
          >
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
          <div
            aria-hidden="true"
            className={cx(
              'h-px bg-line-divider',
              stacked ? 'ml-[6px] mt-[4px]' : 'absolute left-[23px] top-[79px] w-[1822px]',
            )}
          />

          <div
            className={
              stacked ? 'mt-[8px]' : 'absolute left-[17px] top-[87px] h-[306px] w-[1840px]'
            }
          >
            {rows.length > 0 && (
              <ul className={stacked ? undefined : 'scroll-area h-full w-[1846px]'}>
                {rows.map((row, index) => (
                  <li
                    key={row.run.id}
                    className={cx(
                      'relative rounded-[9px] text-[13px]',
                      stacked ? 'h-[52px]' : 'h-[44px]',
                    )}
                    style={{
                      backgroundColor: index % 2 === 1 ? 'var(--surface-row-stripe)' : undefined,
                    }}
                  >
                    <Cell
                      left={COLUMNS.run}
                      width={110}
                      className={`${MONO_CELL} text-ink-secondary`}
                    >
                      <span title={row.run.id}>run_{row.run.id.slice(0, 4)}</span>
                    </Cell>
                    <Cell
                      left={COLUMNS.variant}
                      width={280}
                      className="text-[14px] font-semibold text-ink-primary"
                    >
                      <span className="truncate">{row.variantLabel}</span>
                    </Cell>
                    <Cell
                      left={COLUMNS.policy}
                      width={140}
                      className="font-medium text-ink-secondary"
                    >
                      {policyLabel(row.run.routing_policy)}
                    </Cell>
                    <Cell
                      left={COLUMNS.started}
                      width={170}
                      className="font-medium text-ink-secondary"
                    >
                      {row.run.started_at == null ? DASH : formatShortMoment(row.run.started_at)}
                    </Cell>
                    <Cell
                      left={COLUMNS.duration}
                      width={130}
                      className="font-medium text-ink-secondary"
                    >
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
                    <Cell
                      left={COLUMNS.hash}
                      width={240}
                      className={`${MONO_CELL} text-ink-muted`}
                    >
                      <span title={row.run.config_hash}>{formatHash(row.run.config_hash)}</span>
                    </Cell>
                    <Cell left={COLUMNS.status} width={170} className="font-semibold">
                      <StatusCell run={row.run} />
                    </Cell>

                    <span
                      className="absolute inset-y-0 flex items-center gap-[8px]"
                      style={{ left: COLUMNS.actions - 17 }}
                    >
                      <RowAction
                        stacked={stacked}
                        label="Открыть результат"
                        icon={<SquareArrowOutUpRight aria-hidden="true" className="size-[16px]" />}
                        onClick={() => {
                          onOpen(row);
                        }}
                      />
                      <RowAction
                        stacked={stacked}
                        label="Скачать Evidence Pack"
                        icon={<Download aria-hidden="true" className="size-[16px]" />}
                        disabled={row.run.status !== 'succeeded'}
                        onClick={() => {
                          onEvidencePack(row);
                        }}
                      />
                      <RowAction
                        stacked={stacked}
                        label="В сравнение"
                        icon={<GitCompare aria-hidden="true" className="size-[16px]" />}
                        disabled={row.run.status !== 'succeeded'}
                        onClick={() => {
                          onCompare(row);
                        }}
                      />
                      <RowAction
                        stacked={stacked}
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
        </div>
      </div>

      {/* Пустое состояние вне прокрутки вбок: объяснение видно целиком в ширину карточки. */}
      {rows.length === 0 && (
        <div
          className={
            stacked
              ? 'min-h-[200px] px-[16px]'
              : 'absolute left-[17px] top-[87px] h-[306px] w-[1840px]'
          }
        >
          <EmptyState
            title="Расчётов ещё нет"
            hint="Запустите расчёт кнопкой «Рассчитать» в строке варианта — он появится здесь со статусом и длительностью."
          />
        </div>
      )}
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
      className={cx('absolute inset-y-0 flex items-center overflow-hidden', className)}
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
  stacked,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  stacked: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        stacked ? 'size-[40px]' : 'size-[30px]',
        'flex items-center justify-center rounded-sm border border-line text-accent-blue transition-colors duration-150 hover:border-line-strong hover:bg-[var(--surface-row-active)] disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}
