import { AlertCircle, ChevronRight, Clock, Crosshair, FolderClosed, Rocket, SatelliteDish, Trash2 } from 'lucide-react';

import type { ClientComparison, Run } from '@/api/types';
import { ErrorBlock, Skeleton } from '@/components/state/States';
import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';
import { formatGap, formatTick, policyLabel } from '@/lib/run-format';
import { formatPoints, rowKey } from './format';
import { useCardBox } from '@/components/layout/box';
import { useCanvasTextSize } from '@/app/use-viewport';
import { useStacked } from '@/app/viewport-mode';
import { withTextGrowth } from '@/styles/readable-text';

/**
 * Колонки списка отказов. Капс заголовков и время в строках на ужатом полотне крупнее
 * макетного (`readable-text.ts`): «ВКЛ» наезжал на «ОБЪЕКТ», «НАЧАЛО» — на «ДЛИТ.», а
 * «1 ч 43 мин» обрезалась. Колонки получают запас роста, его забирает у названия объекта
 * гибкая колонка, так что заголовки и строки остаются выровненными.
 */
const TOGGLE_COLUMN = { width: withTextGrowth(26, 24) };
const START_COLUMN = { width: withTextGrowth(64, 20) };
const DURATION_COLUMN = { width: withTextGrowth(76, 14) };

export interface FailureRowRef {
  readonly kind: 'satellite' | 'gateway';
  readonly index: number;
  readonly id: string;
  readonly startS: number;
  readonly endS: number;
}

interface FailuresCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly FailureRowRef[];
  readonly disabled: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onRemove: (row: FailureRowRef) => void;
  readonly onAdd: () => void;
  /** Подсветка компонент связности на карте: одна кнопка включает её и выключает. */
  readonly splitShown: boolean;
  readonly splitAvailable: boolean;
  readonly onToggleSplit: () => void;
  readonly pickingOnMap: boolean;
  readonly onPickOnMap: () => void;

  readonly baseRuns: readonly Run[];
  readonly baseRunId: string | null;
  readonly onBaseRun: (runId: string) => void;

  readonly applying: boolean;
  readonly applyError: string | null;
  readonly onApply: () => void;
  readonly onReset: () => void;

  readonly perClient: readonly ClientComparison[] | null;
  readonly comparisonError: string | null;
  readonly comparisonLoading: boolean;
  readonly onRetryComparison: () => void;
  readonly selectedClientId: string | null;
  readonly onSelectClient: (clientId: string) => void;
  readonly firstDivergenceTS: number | null;
  readonly onSeek: (tS: number) => void;
}

/** Левая панель экрана «Отказы» (`14_SCREENS.md` §3.1), узел макета `42:386`. */
export function FailuresCard(props: FailuresCardProps) {
  const affected = (props.perClient ?? []).filter((item) => item.affected);
  const untouched = (props.perClient ?? []).filter((item) => !item.affected);

  const box = useCardBox(props);
  // В потоке панель управляется пальцем: мелкие флажки и корзины макета получают
  // область касания 40px, а на полотне остаются в размерах макета.
  const stacked = useStacked();
  const textSize = useCanvasTextSize();
  const captionGrown = !stacked && textSize(12) > 12;

  return (
    <div
      className={`card-glass ${box.positionClass} flex flex-col px-[23px] pb-[16px] pt-[15px]`}
      style={box.style}
    >
      <p className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        База сравнения
      </p>
      <Select
        label="Расчёт, с которым сравнивать"
        className="mt-[8px]"
        value={props.baseRunId ?? ''}
        onChange={props.onBaseRun}
        placeholder={props.baseRuns.length === 0 ? 'Завершённых расчётов нет' : 'Выберите расчёт'}
        icon={<FolderClosed aria-hidden="true" className="size-[16px] shrink-0 text-ink-secondary" />}
        options={props.baseRuns.map((run) => ({
          value: run.id,
          title: `${policyLabel(run.routing_policy)} · ${run.config_hash.slice(0, 8)}`,
          meta:
            run.finished_at === null || run.finished_at === undefined
              ? 'без даты'
              : new Date(run.finished_at).toLocaleString('ru-RU'),
        }))}
      />

      <div className="mt-[16px] flex items-center">
        <h3 className="text-base font-semibold text-ink-primary">Отказы</h3>
        <span className="ml-[10px] rounded-pill bg-[rgba(255,92,110,0.2)] px-[8px] py-[2px] text-micro font-semibold text-status-danger">
          {props.rows.length}
        </span>
        <button
          type="button"
          onClick={props.onAdd}
          className={cx(
            'ml-auto text-caption font-semibold text-accent-blue',
            stacked && 'h-[40px] px-[4px]',
          )}
        >
          + Добавить
        </button>
      </div>

      <div className="mt-[10px] flex text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        <span className={stacked ? 'w-[40px]' : undefined} style={stacked ? undefined : TOGGLE_COLUMN}>
          Вкл
        </span>
        <span className="flex-1">Объект</span>
        <span className="shrink-0" style={START_COLUMN}>Начало</span>
        <span className="shrink-0" style={DURATION_COLUMN}>Длит.</span>
        <span className={stacked ? 'w-[40px]' : 'w-[20px]'} />
      </div>
      <div aria-hidden="true" className="mt-[6px] h-px bg-line-divider" />

      {props.rows.length === 0 ? (
        <p className="mt-[10px] rounded-sm border border-line-subtle bg-surface-sunken px-[11px] py-[9px] text-caption text-ink-secondary">
          Отказов в черновике нет. Добавьте интервал или кликните аппарат на карте.
        </p>
      ) : (
        <ul
          className={cx(
            'mt-[8px] space-y-[2px]',
            !stacked && 'max-h-[148px] overflow-y-auto pr-[2px] [scrollbar-width:thin]',
          )}
        >
          {props.rows.map((row) => {
            const key = rowKey(row.kind, row.index);
            const off = props.disabled.has(key);
            return (
              <li
                key={key}
                className={cx(
                  'flex items-center rounded-[10px]',
                  stacked ? 'h-[44px]' : 'h-[34px] px-[7px]',
                  off ? 'opacity-45' : 'bg-surface-rowActive',
                )}
              >
                <label className={cx('flex shrink-0 items-center', stacked && 'size-[40px] justify-center')}>
                  <input
                    type="checkbox"
                    checked={!off}
                    aria-label={`Учитывать отказ ${row.id}`}
                    onChange={() => { props.onToggle(key); }}
                    className={cx('accent-[var(--accent-violet)]', stacked ? 'size-[18px]' : 'size-[14px]')}
                  />
                </label>
                {row.kind === 'satellite' ? (
                  <Rocket aria-hidden="true" className="ml-[8px] size-[14px] shrink-0 text-ink-secondary" />
                ) : (
                  <SatelliteDish aria-hidden="true" className="ml-[8px] size-[14px] shrink-0 text-ink-secondary" />
                )}
                <span
                  title={row.id}
                  className="ml-[7px] min-w-0 flex-1 truncate text-caption font-semibold text-ink-primary"
                >
                  {row.id}
                </span>
                <span className="shrink-0 text-caption text-ink-secondary" style={START_COLUMN} data-numeric>
                  {formatTick(row.startS)}
                </span>
                {/* Длительность шире начала: «1 ч 43 мин» в 64px упиралась в корзину. */}
                <span
                  className="shrink-0 truncate text-caption text-ink-secondary"
                  style={DURATION_COLUMN}
                  data-numeric
                >
                  {formatGap(row.endS - row.startS)}
                </span>
                <button
                  type="button"
                  aria-label={`Удалить отказ ${row.id}`}
                  onClick={() => { props.onRemove(row); }}
                  className={cx(
                    'flex shrink-0 items-center text-ink-muted transition-colors duration-150 hover:text-status-danger',
                    stacked ? 'size-[40px] justify-center' : 'w-[20px] justify-end',
                  )}
                >
                  <Trash2 aria-hidden="true" className="size-[14px]" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-[12px] flex gap-[9px]">
        <button
          type="button"
          onClick={props.onPickOnMap}
          aria-pressed={props.pickingOnMap}
          className={cx(
            'flex h-[40px] flex-1 items-center justify-center gap-[8px] rounded-[11px] border text-caption font-semibold transition-colors duration-150',
            props.pickingOnMap
              ? 'border-accent-violet bg-surface-rowActive text-ink-primary'
              : 'border-line bg-surface-raised text-ink-primary',
          )}
        >
          <Crosshair aria-hidden="true" className="size-[15px]" />
          Выбрать на карте
        </button>
        <button
          type="button"
          onClick={props.onToggleSplit}
          aria-pressed={props.splitShown}
          disabled={!props.splitAvailable}
          title={
            props.splitAvailable
              ? undefined
              : 'У выбранного клиента нет видимых спутников на этом отсчёте'
          }
          className={cx(
            'flex h-[40px] flex-1 items-center justify-center gap-[8px] rounded-[11px] border text-caption font-semibold transition-colors duration-150 disabled:opacity-45',
            props.splitShown
              ? 'border-accent-violet bg-surface-rowActive text-ink-primary'
              : 'border-line bg-surface-raised text-ink-primary',
          )}
        >
          <AlertCircle aria-hidden="true" className="size-[15px]" />
          {props.splitShown ? 'Скрыть разрыв' : 'Показать разрыв'}
        </button>
      </div>

      {props.pickingOnMap && (
        <p className="mt-[8px] text-caption text-ink-secondary">
          Кликните спутник на карте — откроется окно отказа с его идентификатором. Аппараты текущего
          маршрута выбранного клиента подсвечены.
        </p>
      )}

      <div className="mt-[12px] flex gap-[7px]">
        <button
          type="button"
          onClick={props.onApply}
          disabled={props.applying || props.rows.length === 0}
          className="h-[42px] flex-1 rounded-[11px] bg-accent-violet text-caption font-semibold text-ink-onAccent shadow-glow-violet disabled:opacity-45"
        >
          {props.applying ? 'Считаем…' : 'Применить отказ'}
        </button>
        <button
          type="button"
          onClick={props.onReset}
          className="h-[42px] w-[118px] rounded-[11px] border border-line bg-surface-chip text-caption font-semibold text-ink-secondary"
        >
          Сбросить
        </button>
      </div>

      {props.applyError !== null && (
        <p role="alert" className="mt-[8px] text-caption text-status-danger">
          {props.applyError}
        </p>
      )}

      <p className="mt-[16px] text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        Затронутые клиенты · {affected.length}
      </p>

      <div className={cx('mt-[8px]', !stacked && 'scroll-area min-h-0 flex-1 pr-[6px]')}>
        {props.comparisonError !== null ? (
          <div className="h-[72px] rounded-sm border border-line-subtle bg-surface-sunken">
            <ErrorBlock
              title="Сравнение не получено"
              message={props.comparisonError}
              onRetry={props.onRetryComparison}
              compact
            />
          </div>
        ) : props.comparisonLoading ? (
          <Skeleton className="h-[100px] w-full" />
        ) : props.perClient === null ? (
          <p className="text-caption text-ink-secondary">
            Сравнение появится после кнопки «Применить отказ»: нужны два завершённых расчёта — база и
            расчёт с отказом.
          </p>
        ) : (
          <ul className="space-y-[6px]">
            {[...affected, ...untouched].map((item) => (
              <li key={item.client_id}>
                <button
                  type="button"
                  onClick={() => { props.onSelectClient(item.client_id); }}
                  aria-pressed={item.client_id === props.selectedClientId}
                  className={cx(
                    'flex w-full items-center rounded-sm border px-[13px] text-left',
                    stacked ? 'min-h-[48px] py-[6px]' : 'h-[48px]',
                    item.client_id === props.selectedClientId
                      ? 'border-[rgba(145,132,255,0.7)] bg-surface-rowActive'
                      : 'border-line-subtle bg-surface-sunken',
                    !item.affected && 'opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-semibold text-ink-primary">
                      {item.client_id}
                    </span>
                    {/* Короткая форма: полная фраза про отсчёты обрезалась посередине слова
                        уже на макетной ширине панели. Целиком она в подсказке. */}
                    <span
                      title={
                        item.affected
                          ? `Маршрут сохранился на ${item.route_kept_ticks} отсчётах, перестроен на ${item.route_rebuilt_ticks}`
                          : undefined
                      }
                      className={cx('block text-caption text-ink-secondary', !stacked && 'truncate')}
                    >
                      {item.affected
                        ? `сохранён ${item.route_kept_ticks} · перестроен ${item.route_rebuilt_ticks} отсч.`
                        : 'маршрут не изменился'}
                    </span>
                  </span>
                  <span className="ml-[8px] shrink-0 text-right">
                    <span
                      className={cx(
                        'block text-caption font-semibold',
                        item.availability_delta < 0 ? 'text-status-danger' : 'text-status-success',
                      )}
                      data-numeric
                    >
                      {formatPoints(item.availability_delta)}
                    </span>
                    <span className="block text-micro text-ink-muted" data-numeric>
                      {item.outage_diff.length} изм.
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="ml-[8px] size-[14px] text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.firstDivergenceTS !== null && (
        <button
          type="button"
          onClick={() => { props.onSeek(props.firstDivergenceTS ?? 0); }}
          className={cx(
            'mt-[10px] flex items-center gap-[10px] rounded-[11px] border border-[rgba(46,139,251,0.45)] bg-[rgba(46,139,251,0.16)] px-[13px] text-left text-caption font-semibold text-accent-blue',
            stacked ? 'min-h-[42px] py-[8px]' : 'h-[42px]',
          )}
        >
          <Clock aria-hidden="true" className="size-[15px] shrink-0" />
          {!captionGrown ? (
            <span className={stacked ? undefined : 'truncate'}>
              Открыть первый затронутый момент · {formatTick(props.firstDivergenceTS)}
            </span>
          ) : (
            // Подросший на ноутбуке кегль в строку не помещается, и уступает место только
            // подпись: момент, к которому ведёт кнопка, виден всегда. Пока текст макетный,
            // разметка прежняя — отдельные блоки сдвинули бы глифы на доли пикселя.
            <span className="flex min-w-0">
              <span className="truncate" title="Открыть первый затронутый момент">
                Открыть первый затронутый момент
              </span>
              <span className="shrink-0 whitespace-pre">{` · ${formatTick(props.firstDivergenceTS)}`}</span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
