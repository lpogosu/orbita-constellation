import { AlertCircle, ChevronRight, Clock, Crosshair, FolderClosed, Rocket, SatelliteDish, Trash2 } from 'lucide-react';

import type { ClientComparison, Run } from '@/api/types';
import { Skeleton } from '@/components/state/States';
import { cx } from '@/lib/cx';
import { formatGap, formatTick } from '@/lib/run-format';
import { formatPoints, rowKey } from './format';

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
  readonly onShowSplit: () => void;
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
  readonly selectedClientId: string | null;
  readonly onSelectClient: (clientId: string) => void;
  readonly firstDivergenceTS: number | null;
  readonly onSeek: (tS: number) => void;
}

/** Левая панель экрана «Отказы» (`14_SCREENS.md` §3.1), узел макета `42:386`. */
export function FailuresCard(props: FailuresCardProps) {
  const affected = (props.perClient ?? []).filter((item) => item.affected);
  const untouched = (props.perClient ?? []).filter((item) => !item.affected);

  return (
    <div
      className="card-glass absolute flex flex-col px-[23px] pb-[16px] pt-[15px]"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        backgroundPosition: `0 0, ${-props.x}px ${-props.y}px`,
      }}
    >
      <p className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        База сравнения
      </p>
      <label className="mt-[8px] block">
        <span className="sr-only">Расчёт, с которым сравнивать</span>
        <span className="relative block">
          <FolderClosed
            aria-hidden="true"
            className="pointer-events-none absolute left-[13px] top-[16px] size-[16px] text-ink-secondary"
          />
          <select
            value={props.baseRunId ?? ''}
            onChange={(event) => { props.onBaseRun(event.target.value); }}
            className="h-[48px] w-full rounded-sm border border-line bg-surface-input pl-[37px] pr-[13px] text-small font-medium text-ink-primary"
          >
            {props.baseRuns.length === 0 && <option value="">Завершённых расчётов нет</option>}
            {props.baseRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.routing_policy} · {run.config_hash.slice(0, 8)} ·{' '}
                {run.finished_at === null || run.finished_at === undefined
                  ? 'без даты'
                  : new Date(run.finished_at).toLocaleString('ru-RU')}
              </option>
            ))}
          </select>
        </span>
      </label>

      <div className="mt-[16px] flex items-center">
        <h3 className="text-base font-semibold text-ink-primary">Отказы</h3>
        <span className="ml-[10px] rounded-pill bg-[rgba(255,92,110,0.2)] px-[8px] py-[2px] text-micro font-semibold text-status-danger">
          {props.rows.length}
        </span>
        <button
          type="button"
          onClick={props.onAdd}
          className="ml-auto text-caption font-semibold text-accent-blue"
        >
          + Добавить
        </button>
      </div>

      <div className="mt-[10px] flex text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        <span className="w-[26px]">Вкл</span>
        <span className="flex-1">Объект</span>
        <span className="w-[64px]">Начало</span>
        <span className="w-[64px]">Длит.</span>
        <span className="w-[20px]" />
      </div>
      <div aria-hidden="true" className="mt-[6px] h-px bg-line-divider" />

      {props.rows.length === 0 ? (
        <p className="mt-[10px] rounded-sm border border-line-subtle bg-surface-sunken px-[11px] py-[9px] text-caption text-ink-secondary">
          Отказов в черновике нет. Добавьте интервал или кликните аппарат на карте.
        </p>
      ) : (
        <ul className="mt-[8px] max-h-[148px] space-y-[2px] overflow-y-auto pr-[2px] [scrollbar-width:thin]">
          {props.rows.map((row) => {
            const key = rowKey(row.kind, row.index);
            const off = props.disabled.has(key);
            return (
              <li
                key={key}
                className={cx(
                  'flex h-[34px] items-center rounded-[10px] px-[7px]',
                  off ? 'opacity-45' : 'bg-surface-rowActive',
                )}
              >
                <input
                  type="checkbox"
                  checked={!off}
                  aria-label={`Учитывать отказ ${row.id}`}
                  onChange={() => { props.onToggle(key); }}
                  className="size-[14px] accent-[var(--accent-violet)]"
                />
                {row.kind === 'satellite' ? (
                  <Rocket aria-hidden="true" className="ml-[8px] size-[14px] text-ink-secondary" />
                ) : (
                  <SatelliteDish aria-hidden="true" className="ml-[8px] size-[14px] text-ink-secondary" />
                )}
                <span className="ml-[7px] flex-1 truncate text-caption font-semibold text-ink-primary">
                  {row.id}
                </span>
                <span className="w-[64px] text-caption text-ink-secondary" data-numeric>
                  {formatTick(row.startS)}
                </span>
                <span className="w-[64px] text-caption text-ink-secondary" data-numeric>
                  {formatGap(row.endS - row.startS)}
                </span>
                <button
                  type="button"
                  aria-label={`Удалить отказ ${row.id}`}
                  onClick={() => { props.onRemove(row); }}
                  className="text-ink-muted transition-colors duration-150 hover:text-status-danger"
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
          onClick={props.onShowSplit}
          className="flex h-[40px] flex-1 items-center justify-center gap-[8px] rounded-[11px] border border-line bg-surface-raised text-caption font-semibold text-ink-primary"
        >
          <AlertCircle aria-hidden="true" className="size-[15px]" />
          Показать разрыв
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

      <div className="scroll-area mt-[8px] min-h-0 flex-1 pr-[6px]">
        {props.comparisonError !== null ? (
          <p role="alert" className="text-caption text-status-danger">
            {props.comparisonError}
          </p>
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
                    'flex h-[48px] w-full items-center rounded-sm border px-[13px] text-left',
                    item.client_id === props.selectedClientId
                      ? 'border-[rgba(145,132,255,0.7)] bg-surface-rowActive'
                      : 'border-line-subtle bg-surface-sunken',
                    !item.affected && 'opacity-60',
                  )}
                >
                  <span className="flex-1">
                    <span className="block text-small font-semibold text-ink-primary">
                      {item.client_id}
                    </span>
                    <span className="block text-caption text-ink-secondary">
                      {item.affected
                        ? `${item.route_kept_ticks} отсчётов маршрут сохранился · ${item.route_rebuilt_ticks} перестроен`
                        : 'маршрут не изменился'}
                    </span>
                  </span>
                  <span className="text-right">
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
          className="mt-[10px] flex h-[42px] items-center gap-[10px] rounded-[11px] border border-[rgba(46,139,251,0.45)] bg-[rgba(46,139,251,0.16)] px-[13px] text-caption font-semibold text-accent-blue"
        >
          <Clock aria-hidden="true" className="size-[15px]" />
          Открыть первый затронутый момент · {formatTick(props.firstDivergenceTS)}
        </button>
      )}
    </div>
  );
}
