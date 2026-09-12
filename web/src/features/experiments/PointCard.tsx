import { AlertCircle, ArrowLeftRight, Plus } from 'lucide-react';

import type { Experiment, ExperimentPoint } from '@/api/types';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatShareShort } from '@/lib/measures';
import { formatGap } from '@/lib/run-format';
import { pointTitle } from './points';

const LEFT = 1403;
const TOP = 200;

interface PointCardProps {
  readonly experiment: Experiment;
  readonly point: ExperimentPoint | null;
  readonly target: number;
  readonly axisTitle: (path: string) => string;
  readonly materializing: boolean;
  readonly onMaterialize: (point: ExperimentPoint) => void;
  readonly onCompare: (point: ExperimentPoint) => void;
  readonly onOpenNetwork: (point: ExperimentPoint) => void;
  readonly onSelect: (point: ExperimentPoint) => void;
}

/**
 * «Выбранная точка» и «Топ-5 конфигураций» (узел `145:1128`). Порядок в топе — тот, в
 * котором точки пришли в `best_points`: ранжирование ADR-006 делает сервис, и пересортировка
 * на экране развела бы два ответа на один вопрос.
 */
export function PointCard({
  experiment,
  point,
  target,
  axisTitle,
  materializing,
  onMaterialize,
  onCompare,
  onOpenNetwork,
  onSelect,
}: PointCardProps) {
  const reached = point !== null && (point.min_client_availability ?? 0) >= target;
  const budgetLeft = experiment.budget.max_points - experiment.completed_points;

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[656px] w-[491px]"
      style={{ left: LEFT, top: TOP }}
    >
      <p className="absolute left-[23px] top-[19px] text-[10px] font-semibold tracking-[0.8px] text-ink-muted">
        ВЫБРАННАЯ ТОЧКА
      </p>

      {point === null ? (
        <div className="absolute inset-x-[23px] top-[45px] h-[240px]">
          <EmptyState
            title="Точка не выбрана"
            hint="Нажмите ячейку тепловой карты или строку в таблице прогонов, чтобы увидеть её показатели."
          />
        </div>
      ) : (
        <>
          <h2 className="absolute left-[23px] top-[39px] w-[445px] truncate text-[22px] font-bold text-ink-primary">
            {pointTitle(point, axisTitle)}
          </h2>
          <p className="absolute left-[23px] top-[73px] w-[445px] truncate text-caption text-ink-secondary">
            {point.run_id === null || point.run_id === undefined
              ? 'прогон ещё не запускался'
              : `прогон ${point.run_id.slice(0, 8)}`}{' '}
            · конфигурация {point.config_hash.slice(0, 12)}
          </p>

          <Metric
            left={23}
            top={107}
            value={
              point.min_client_availability === null || point.min_client_availability === undefined
                ? '—'
                : formatShareShort(point.min_client_availability)
            }
            caption="min доступность"
            good={reached}
          />
          <Metric
            left={247}
            top={107}
            value={
              point.worst_max_gap_s === null || point.worst_max_gap_s === undefined
                ? '—'
                : formatGap(point.worst_max_gap_s)
            }
            caption="макс. окно"
          />
          <Metric
            left={23}
            top={169}
            value={
              point.mean_client_availability === null ||
              point.mean_client_availability === undefined
                ? '—'
                : formatShareShort(point.mean_client_availability)
            }
            caption="средняя доступность"
          />
          <Metric
            left={247}
            top={169}
            value={reached ? 'достигнута' : 'не достигнута'}
            caption={`цель ${formatShareShort(target)}`}
            good={reached}
          />

          <button
            type="button"
            disabled={materializing || point.run_id === null || point.run_id === undefined}
            onClick={() => { onMaterialize(point); }}
            className={cx(
              'absolute left-[23px] top-[239px] flex h-[46px] w-[266px] items-center gap-[12px] px-[18px]',
              'rounded-sm bg-accent-violet text-[13px] font-semibold text-ink-onAccent',
              'transition-[filter] duration-150 hover:brightness-110',
              'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100',
            )}
          >
            <Plus aria-hidden="true" className="size-[16px]" />
            {materializing ? 'Сохраняем вариант…' : 'Материализовать вариант'}
          </button>
          <button
            type="button"
            disabled={point.run_id === null || point.run_id === undefined}
            onClick={() => { onCompare(point); }}
            className={cx(
              'absolute left-[301px] top-[239px] flex h-[46px] w-[165px] items-center gap-[12px] px-[17px]',
              'rounded-sm border border-line bg-surface-raised text-[13px] font-semibold text-ink-primary',
              'transition-colors duration-150 hover:border-line-strong',
              'disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            <ArrowLeftRight aria-hidden="true" className="size-[16px]" />
            Сравнить
          </button>

          <button
            type="button"
            disabled={point.run_id === null || point.run_id === undefined}
            onClick={() => { onOpenNetwork(point); }}
            className="absolute left-[23px] top-[291px] text-caption font-semibold text-accent-blue transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-45"
          >
            Открыть в сети ›
          </button>
        </>
      )}

      <div className="absolute left-[23px] top-[313px] h-px w-[443px] bg-line-divider" />

      <p className="absolute left-[23px] top-[331px] text-[10px] font-semibold tracking-[0.8px] text-ink-muted">
        ТОП-5 КОНФИГУРАЦИЙ
      </p>

      {experiment.best_points.length === 0 ? (
        <p className="absolute left-[23px] top-[355px] w-[443px] text-caption text-ink-secondary">
          Пока ни одна точка не посчитана: список появится по мере готовности прогонов.
        </p>
      ) : (
        <>
          <div
            className="absolute left-[23px] top-[355px] grid w-[443px] text-[9px] font-semibold tracking-[0.54px] text-ink-muted"
            style={{ gridTemplateColumns: '28px 1fr 104px 90px' }}
          >
            <span>#</span>
            <span>КОНФИГУРАЦИЯ</span>
            <span>MIN ДОСТ.</span>
            <span>МАКС. ОКНО</span>
          </div>
          <div className="absolute left-[23px] top-[371px] h-px w-[443px] bg-line-divider" />

          <ul className="scroll-area absolute left-[17px] top-[379px] max-h-[170px] w-[455px] pr-[6px]">
            {experiment.best_points.slice(0, 5).map((best, index) => (
              <li key={best.id}>
                <button
                  type="button"
                  onClick={() => { onSelect(best); }}
                  className={cx(
                    'grid h-[34px] w-full items-center rounded-sm px-[6px] text-left',
                    'transition-colors duration-150 hover:bg-surface-chip',
                    best.id === point?.id && 'bg-surface-row-active',
                  )}
                  style={{ gridTemplateColumns: '28px 1fr 104px 90px' }}
                >
                  <span className="text-caption font-semibold text-ink-muted">{index + 1}</span>
                  <span className="truncate pr-[10px] text-[13px] font-medium text-ink-primary">
                    {pointTitle(best, axisTitle)}
                  </span>
                  <span
                    className={cx(
                      'text-[13px] font-semibold',
                      (best.min_client_availability ?? 0) >= target
                        ? 'text-status-success'
                        : 'text-ink-primary',
                    )}
                    data-numeric
                  >
                    {best.min_client_availability === null ||
                    best.min_client_availability === undefined
                      ? '—'
                      : formatShareShort(best.min_client_availability)}
                  </span>
                  <span className="text-[13px] text-ink-secondary" data-numeric>
                    {best.worst_max_gap_s === null || best.worst_max_gap_s === undefined
                      ? '—'
                      : formatGap(best.worst_max_gap_s)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {budgetLeft <= Math.ceil(experiment.budget.max_points / 5) && (
        <div
          className="absolute left-[23px] top-[559px] h-[52px] w-[443px] overflow-hidden rounded-sm border"
          style={{
            background: 'var(--status-warning-soft)',
            borderColor: 'var(--status-warning-border)',
          }}
        >
          <AlertCircle
            aria-hidden="true"
            className="absolute left-[13px] top-[9px] size-[15px] text-status-warning"
          />
          <p className="absolute left-[35px] top-[7px] text-caption font-semibold text-status-warning">
            Бюджет почти исчерпан: {experiment.completed_points} из {experiment.budget.max_points}{' '}
            прогонов
          </p>
          <p className="absolute left-[35px] top-[27px] text-[11px] text-ink-muted">
            после {experiment.budget.max_points} прогонов эксперимент остановится автоматически
          </p>
        </div>
      )}
    </Card>
  );
}

function Metric({
  left,
  top,
  value,
  caption,
  good,
}: {
  left: number;
  top: number;
  value: string;
  caption: string;
  good?: boolean;
}) {
  return (
    <div
      className="absolute h-[54px] w-[212px] overflow-hidden rounded-sm border border-line-divider bg-surface-sunken"
      style={{ left, top }}
    >
      <p
        className={cx(
          'absolute left-[13px] top-[5px] text-[18px] font-bold',
          good === true ? 'text-status-success' : 'text-ink-primary',
        )}
        data-numeric
      >
        {value}
      </p>
      <p className="absolute left-[13px] top-[31px] text-[11px] text-ink-muted">{caption}</p>
    </div>
  );
}
