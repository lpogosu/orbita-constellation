import { Check, Download, GitCompare, Play, Radar, Star } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Run, Variant } from '@/api/types';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import {
  DASH,
  changeText,
  formatDate,
  formatHash,
  formatShare,
  runStatusLabel,
  variantLetter,
} from '@/lib/run-format';
import { cx } from '@/lib/cx';

const LEFT = 25;
const TOP = 214;

/**
 * Колонки взяты с макетных x (147:1242…147:1249), но их содержание — из карточки экрана:
 * «политика», «плоск.×спутн.» и «макс. окно» уступили место созданию, родителю,
 * `config_hash` и изменённым параметрам, без которых «вернуться к варианту» не работает.
 */
const COLUMNS = {
  index: 23,
  title: 59,
  created: 329,
  parent: 469,
  hash: 619,
  changes: 759,
  run: 889,
  actions: 1059,
} as const;

export interface VariantRowView {
  readonly variant: Variant;
  readonly index: number;
  readonly parentTitle: string | null;
  readonly latestRun: Run | null;
  readonly minAvailability: number | null;
  readonly active: boolean;
}

interface VariantsCardProps {
  /**
   * Варианты, происхождение и прогоны приходят одним `getProjectBoard`, поэтому загрузка
   * и ошибка показаны экраном сразу для всех трёх карточек: три одинаковых сообщения об
   * одном и том же отказе — это три раза одна и та же новость.
   */
  rows: readonly VariantRowView[];
  onOpenNetwork: (row: VariantRowView) => void;
  onRun: (row: VariantRowView) => void;
  onCompare: (row: VariantRowView) => void;
  onExport: (row: VariantRowView) => void;
  /** Вариант, для которого уже запущен расчёт по кнопке строки. */
  runningVariantId: string | null;
}

/** Card / Варианты (147:1239). */
export function VariantsCard({
  rows,
  onOpenNetwork,
  onRun,
  onCompare,
  onExport,
  runningVariantId,
}: VariantsCardProps) {
  const baseTitle = rows.find((row) => row.variant.parent_variant_id == null)?.variant.title;

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[25px] top-[214px] h-[410px] w-[1250px]"
    >
      <h2 className="absolute left-[23px] top-[17px] text-title-m font-semibold text-ink-primary">
        Варианты
      </h2>
      {rows.length > 0 && (
        <p className="absolute left-[147px] top-[23px] text-caption text-ink-secondary">
          {rows.length} вариантов{baseTitle === undefined ? '' : ` · база — ${baseTitle}`}
        </p>
      )}

      <div className="absolute left-[23px] top-[59px] h-[14px] w-[1202px] text-[9px] font-semibold uppercase tracking-[0.54px] text-ink-muted">
        <Head left={COLUMNS.index}>#</Head>
        <Head left={COLUMNS.title}>Название</Head>
        <Head left={COLUMNS.created}>Создан</Head>
        <Head left={COLUMNS.parent}>Родитель</Head>
        <Head left={COLUMNS.hash}>config_hash</Head>
        <Head left={COLUMNS.changes}>Изменено</Head>
        <Head left={COLUMNS.run}>Последний расчёт</Head>
        <Head left={COLUMNS.actions}>Действия</Head>
      </div>
      <div aria-hidden="true" className="absolute left-[23px] top-[77px] h-px w-[1202px] bg-line-divider" />

      <div className="absolute left-[17px] top-[85px] h-[304px] w-[1220px]">
        {rows.length === 0 && (
          <EmptyState
            title="Вариантов нет"
            hint="Проект создаётся сразу с первым вариантом — если список пуст, сценарий не сохранился."
          />
        )}

        {rows.length > 0 && (
          <ul className="scroll-area h-full w-[1226px]">
            {rows.map((row, index) => (
              <li
                key={row.variant.id}
                className={cx(
                  'relative h-[44px] rounded-[9px] text-[13px]',
                  row.active && 'border border-[var(--border-accent)] bg-[var(--surface-accent-soft)]',
                )}
                style={{
                  backgroundColor:
                    !row.active && index % 2 === 1 ? 'var(--surface-row-stripe)' : undefined,
                }}
              >
                <Cell left={COLUMNS.index} className="font-bold text-ink-muted">
                  {variantLetter(row.index)}
                </Cell>

                <Cell left={COLUMNS.title} width={250} className="text-[14px] font-semibold text-ink-primary">
                  <span className="flex items-center gap-[8px]">
                    <span className="truncate">{row.variant.title}</span>
                    {row.active ? (
                      <Tag icon={<Check aria-hidden="true" className="size-[12px]" />} tone="text-status-success">
                        активный
                      </Tag>
                    ) : (
                      row.variant.parent_variant_id == null && (
                        <Tag icon={<Star aria-hidden="true" className="size-[12px]" />} tone="text-status-neutral">
                          база
                        </Tag>
                      )
                    )}
                  </span>
                </Cell>

                <Cell left={COLUMNS.created} width={130} className="font-medium text-ink-secondary">
                  {formatDate(row.variant.created_at)}
                </Cell>

                <Cell left={COLUMNS.parent} width={140} className="font-medium text-ink-secondary">
                  <span className="truncate">{row.parentTitle ?? DASH}</span>
                </Cell>

                <Cell left={COLUMNS.hash} width={130} className="font-mono text-[12px] text-ink-muted">
                  <span title={row.variant.config_hash}>{formatHash(row.variant.config_hash)}</span>
                </Cell>

                <Cell left={COLUMNS.changes} width={120} className="font-medium text-ink-secondary">
                  <span className="truncate" title={changesHint(row)}>
                    {changesLabel(row)}
                  </span>
                </Cell>

                <Cell left={COLUMNS.run} width={160} className="font-medium text-ink-secondary">
                  {row.latestRun === null ? (
                    <span className="text-ink-muted">расчётов нет</span>
                  ) : (
                    <span className="flex items-baseline gap-[8px]">
                      <span className={statusTone(row.latestRun.status)}>
                        {runStatusLabel(row.latestRun.status)}
                      </span>
                      <span className="font-semibold text-ink-primary" data-numeric>
                        {row.minAvailability === null ? DASH : formatShare(row.minAvailability)}
                      </span>
                    </span>
                  )}
                </Cell>

                <span className="absolute top-[7px] flex gap-[8px]" style={{ left: COLUMNS.actions - 17 }}>
                  <RowAction
                    label="Открыть в сети"
                    icon={<Radar aria-hidden="true" className="size-[16px]" />}
                    onClick={() => {
                      onOpenNetwork(row);
                    }}
                  />
                  <RowAction
                    label={runningVariantId === row.variant.id ? 'Запускаем расчёт' : 'Рассчитать'}
                    icon={<Play aria-hidden="true" className="size-[16px]" />}
                    disabled={runningVariantId !== null}
                    onClick={() => {
                      onRun(row);
                    }}
                  />
                  <RowAction
                    label="В сравнение"
                    icon={<GitCompare aria-hidden="true" className="size-[16px]" />}
                    disabled={row.latestRun === null}
                    onClick={() => {
                      onCompare(row);
                    }}
                  />
                  <RowAction
                    label="Экспорт сценария"
                    icon={<Download aria-hidden="true" className="size-[16px]" />}
                    onClick={() => {
                      onExport(row);
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

function changesLabel(row: VariantRowView): string {
  const changes = row.variant.diff_from_parent ?? [];
  if (changes.length === 0) {
    return row.variant.parent_variant_id == null ? 'базовый' : 'без изменений';
  }
  const first = changes[0];
  return changes.length === 1 && first !== undefined
    ? lastSegment(first.path)
    : `${lastSegment(changes[0]?.path ?? '')} +${String(changes.length - 1)}`;
}

function changesHint(row: VariantRowView): string {
  const changes = row.variant.diff_from_parent ?? [];
  return changes.length === 0
    ? 'Параметры не отличаются от родительского варианта'
    : changes.map(changeText).join('\n');
}

/** В колонке шириной 120 px помещается хвост пути, а полный путь уходит в подсказку. */
function lastSegment(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1] ?? path;
}

function statusTone(status: Run['status']): string {
  if (status === 'succeeded') {
    return 'text-status-success';
  }
  return status === 'failed' || status === 'cancelled' ? 'text-status-danger' : 'text-accent-blue';
}

function Head({ left, children }: { left: number; children: ReactNode }) {
  return (
    <span className="absolute" style={{ left: left - COLUMNS.index }}>
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
  width?: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx('absolute top-[14px] flex items-baseline overflow-hidden', className)}
      style={{ left: left - 17, width }}
    >
      {children}
    </span>
  );
}

function Tag({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <span className={cx('flex shrink-0 items-center gap-[4px] text-[11px] font-semibold', tone)}>
      {icon}
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
