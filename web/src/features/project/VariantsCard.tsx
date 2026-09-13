import { Check, Download, GitCompare, Play, Radar, Star } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Run, Variant } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
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

/**
 * Моноширинный шрифт при той же высоте строки рисует знаки выше пропорционального, и
 * хеш на общей средней линии строки стоял на 2 px выше соседних колонок. Отступ сверху
 * опускает его на общую базовую линию.
 */
const MONO_CELL = 'pt-[4px] font-mono text-[12px]';

/**
 * В потоке таблица сохраняет колонки полотна и прокручивается вбок внутри карточки:
 * восемь колонок в ширину телефона не сжимаются без потери смысла. Строка выше, чтобы
 * кнопки действий стали 40 px — под палец.
 */
const STACKED_TABLE_WIDTH = 1226;

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
  const stacked = useStacked();

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={
        stacked ? 'pb-[12px] pt-[16px]' : 'absolute left-[25px] top-[214px] h-[410px] w-[1250px]'
      }
    >
      <div className={stacked ? 'flex items-baseline gap-[12px] px-[20px]' : 'contents'}>
        <h2
          className={cx(
            'text-title-m font-semibold text-ink-primary',
            stacked ? 'shrink-0' : 'absolute left-[23px] top-[17px]',
          )}
        >
          Варианты
        </h2>
        {rows.length > 0 && (
          <p
            title={baseTitle}
            className={cx(
              'truncate text-caption text-ink-secondary',
              stacked ? 'min-w-0' : 'absolute left-[147px] top-[23px] w-[420px]',
            )}
          >
            {rows.length} вариантов{baseTitle === undefined ? '' : ` · база — ${baseTitle}`}
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
              stacked ? 'relative ml-[6px]' : 'absolute left-[23px] top-[59px] w-[1202px]',
            )}
          >
            <Head left={COLUMNS.index}>#</Head>
            <Head left={COLUMNS.title}>Название</Head>
            <Head left={COLUMNS.created}>Создан</Head>
            <Head left={COLUMNS.parent}>Родитель</Head>
            <Head left={COLUMNS.hash}>config_hash</Head>
            <Head left={COLUMNS.changes}>Изменено</Head>
            <Head left={COLUMNS.run}>Последний расчёт</Head>
            <Head left={COLUMNS.actions}>Действия</Head>
          </div>
          <div
            aria-hidden="true"
            className={cx(
              'h-px bg-line-divider',
              stacked ? 'ml-[6px] mt-[4px]' : 'absolute left-[23px] top-[77px] w-[1202px]',
            )}
          />

          <div
            className={
              stacked ? 'mt-[8px]' : 'absolute left-[17px] top-[85px] h-[304px] w-[1220px]'
            }
          >
            {rows.length > 0 && (
              <ul className={stacked ? undefined : 'scroll-area h-full w-[1226px]'}>
                {rows.map((row, index) => (
                  <li
                    key={row.variant.id}
                    className={cx(
                      'relative rounded-[10px] border border-transparent text-[13px]',
                      stacked ? 'h-[56px]' : 'h-[50px]',
                      row.active &&
                        'border-[var(--border-accent)] bg-[var(--surface-accent-soft)] shadow-[0_4px_14px_rgba(106,79,238,0.12)]',
                    )}
                    style={{
                      backgroundColor: !row.active
                        ? index % 2 === 1
                          ? 'var(--surface-row-stripe)'
                          : 'var(--surface-sunken)'
                        : undefined,
                    }}
                  >
                    <Cell left={COLUMNS.index} className="font-bold text-ink-muted">
                      {variantLetter(row.index)}
                    </Cell>

                    <Cell
                      left={COLUMNS.title}
                      width={250}
                      className="text-[14px] font-semibold text-ink-primary"
                    >
                      <span className="flex items-center gap-[8px]">
                        <span className="truncate">{row.variant.title}</span>
                        {row.active ? (
                          <Tag
                            icon={<Check aria-hidden="true" className="size-[12px]" />}
                            tone="text-status-success"
                          >
                            активный
                          </Tag>
                        ) : (
                          row.variant.parent_variant_id == null && (
                            <Tag
                              icon={<Star aria-hidden="true" className="size-[12px]" />}
                              tone="text-status-neutral"
                            >
                              база
                            </Tag>
                          )
                        )}
                      </span>
                    </Cell>

                    <Cell
                      left={COLUMNS.created}
                      width={130}
                      className="font-medium text-ink-secondary"
                    >
                      {formatDate(row.variant.created_at)}
                    </Cell>

                    <Cell
                      left={COLUMNS.parent}
                      width={140}
                      className="font-medium text-ink-secondary"
                    >
                      <span className="truncate">{row.parentTitle ?? 'исходный'}</span>
                    </Cell>

                    <Cell
                      left={COLUMNS.hash}
                      width={130}
                      className={`${MONO_CELL} text-ink-muted`}
                    >
                      <span title={row.variant.config_hash}>
                        {formatHash(row.variant.config_hash)}
                      </span>
                    </Cell>

                    <Cell
                      left={COLUMNS.changes}
                      width={120}
                      className="font-medium text-ink-secondary"
                    >
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

                    <span
                      className="absolute inset-y-0 flex items-center gap-[8px]"
                      style={{ left: COLUMNS.actions - 17 }}
                    >
                      <RowAction
                        stacked={stacked}
                        label="Открыть в сети"
                        icon={<Radar aria-hidden="true" className="size-[16px]" />}
                        onClick={() => {
                          onOpenNetwork(row);
                        }}
                      />
                      <RowAction
                        stacked={stacked}
                        label={
                          runningVariantId === row.variant.id ? 'Запускаем расчёт' : 'Рассчитать'
                        }
                        icon={<Play aria-hidden="true" className="size-[16px]" />}
                        disabled={runningVariantId !== null}
                        onClick={() => {
                          onRun(row);
                        }}
                      />
                      <RowAction
                        stacked={stacked}
                        label="В сравнение"
                        icon={<GitCompare aria-hidden="true" className="size-[16px]" />}
                        disabled={row.latestRun === null}
                        onClick={() => {
                          onCompare(row);
                        }}
                      />
                      <RowAction
                        stacked={stacked}
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
        </div>
      </div>

      {/* Пустое состояние стоит вне прокрутки вбок: в потоке объяснение должно быть видно
          целиком в ширину карточки, а не посреди таблицы шириной 1226 px. */}
      {rows.length === 0 && (
        <div
          className={
            stacked
              ? 'min-h-[200px] px-[16px]'
              : 'absolute left-[17px] top-[85px] h-[304px] w-[1220px]'
          }
        >
          <EmptyState
            title="Вариантов нет"
            hint="Проект создаётся сразу с первым вариантом — если список пуст, сценарий не сохранился."
          />
        </div>
      )}
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
      className={cx('absolute inset-y-0 flex items-center overflow-hidden', className)}
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
