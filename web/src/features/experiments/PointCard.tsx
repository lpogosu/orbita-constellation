import { AlertCircle, ArrowLeftRight, Plus } from 'lucide-react';

import type { Experiment, ExperimentPoint } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatShareShort } from '@/lib/measures';
import { formatGap } from '@/lib/run-format';
import { bottomAnchoredTop } from '@/styles/readable-text';
import { pointLabel, pointTitle } from './points';
import type { AxisLabel } from './points';

const LEFT = 1403;
const TOP = 200;
const TOP_COLUMNS = '28px minmax(0,1fr) 104px 90px';
/** В узкой колонке числа уже не нуждаются в макетных 104 и 90 пикселях. */
const STACKED_TOP_COLUMNS = '24px minmax(0,1fr) 76px 72px';

interface PointCardProps {
  readonly experiment: Experiment;
  readonly point: ExperimentPoint | null;
  readonly target: number;
  readonly axisTitle: (path: string) => string;
  /** Короткие подписи осей для видимой строки; полные названия остаются в подсказке. */
  readonly axisLabel: (path: string) => AxisLabel;
  readonly materializing: boolean;
  readonly onMaterialize: (point: ExperimentPoint) => void;
  readonly onCompare: (point: ExperimentPoint) => void;
  readonly onOpenNetwork: (point: ExperimentPoint) => void;
  readonly onSelect: (point: ExperimentPoint) => void;
  /** Место карточки в сетке потока; на полотне не используется. */
  readonly stackedClassName?: string;
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
  axisLabel,
  materializing,
  onMaterialize,
  onCompare,
  onOpenNetwork,
  onSelect,
  stackedClassName,
}: PointCardProps) {
  const stacked = useStacked();
  const reached = point !== null && (point.min_client_availability ?? 0) >= target;
  const budgetLeft = experiment.budget.max_points - experiment.completed_points;
  const budgetLow = budgetLeft <= Math.ceil(experiment.budget.max_points / 5);
  const columns = stacked ? STACKED_TOP_COLUMNS : TOP_COLUMNS;

  const sectionLabel = (text: string, canvasClass: string) => (
    <p
      className={cx(
        'text-[10px] font-semibold tracking-[0.8px] text-ink-muted',
        !stacked && `absolute left-[23px] ${canvasClass}`,
      )}
    >
      {text}
    </p>
  );

  const metrics =
    point === null
      ? null
      : [
          {
            value:
              point.min_client_availability === null || point.min_client_availability === undefined
                ? '—'
                : formatShareShort(point.min_client_availability),
            caption: 'min доступность',
            good: reached,
          },
          {
            value:
              point.worst_max_gap_s === null || point.worst_max_gap_s === undefined
                ? '—'
                : formatGap(point.worst_max_gap_s),
            caption: 'макс. окно',
            good: false,
          },
          {
            value:
              point.mean_client_availability === null ||
              point.mean_client_availability === undefined
                ? '—'
                : formatShareShort(point.mean_client_availability),
            caption: 'средняя доступность',
            good: false,
          },
          {
            value: reached ? 'достигнута' : 'не достигнута',
            caption: `цель ${formatShareShort(target)}`,
            good: reached,
          },
        ];

  const selected =
    point === null || metrics === null ? (
      <div className={stacked ? 'min-h-[200px]' : 'absolute inset-x-[23px] top-[45px] h-[240px]'}>
        <EmptyState
          title="Точка не выбрана"
          hint="Нажмите ячейку тепловой карты или строку в таблице прогонов, чтобы увидеть её показатели."
        />
      </div>
    ) : (
      <>
        <h2
          title={pointTitle(point, axisTitle)}
          className={cx(
            'truncate font-bold text-ink-primary',
            stacked ? 'text-[18px] md:text-[22px]' : 'absolute left-[23px] top-[39px] w-[445px] text-[22px]',
          )}
        >
          {pointLabel(point, axisLabel)}
        </h2>
        <p
          className={cx(
            'truncate text-caption text-ink-secondary',
            !stacked && 'absolute left-[23px] top-[73px] w-[445px]',
          )}
        >
          {point.run_id === null || point.run_id === undefined
            ? 'прогон ещё не запускался'
            : `прогон ${point.run_id.slice(0, 8)}`}{' '}
          · конфигурация {point.config_hash.slice(0, 12)}
        </p>

        {stacked ? (
          <div className="grid grid-cols-2 gap-[12px]">
            {metrics.map((metric) => (
              <Metric key={metric.caption} {...metric} />
            ))}
          </div>
        ) : (
          metrics.map((metric, index) => (
            <Metric
              key={metric.caption}
              {...metric}
              left={index % 2 === 0 ? 23 : 247}
              top={index < 2 ? 107 : 169}
            />
          ))
        )}

        <div className={stacked ? 'flex flex-wrap gap-[12px]' : undefined}>
          <button
            type="button"
            disabled={materializing || point.run_id === null || point.run_id === undefined}
            onClick={() => { onMaterialize(point); }}
            className={cx(
              'flex h-[46px] items-center gap-[12px] px-[18px]',
              stacked ? 'min-w-0 flex-[1_1_200px]' : 'absolute left-[23px] top-[239px] w-[266px]',
              'rounded-sm bg-accent-violet text-[13px] font-semibold text-ink-onAccent',
              'transition-[filter] duration-150 hover:brightness-110',
              'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100',
            )}
          >
            <Plus aria-hidden="true" className="size-[16px] shrink-0" />
            {materializing ? 'Сохраняем вариант…' : 'Материализовать вариант'}
          </button>
          <button
            type="button"
            disabled={point.run_id === null || point.run_id === undefined}
            onClick={() => { onCompare(point); }}
            className={cx(
              'flex h-[46px] items-center gap-[12px] px-[17px]',
              stacked ? 'flex-[1_1_140px]' : 'absolute left-[301px] top-[239px] w-[165px]',
              'rounded-sm border border-line bg-surface-raised text-[13px] font-semibold text-ink-primary',
              'transition-colors duration-150 hover:border-line-strong',
              'disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            <ArrowLeftRight aria-hidden="true" className="size-[16px] shrink-0" />
            Сравнить
          </button>
        </div>

        <button
          type="button"
          disabled={point.run_id === null || point.run_id === undefined}
          onClick={() => { onOpenNetwork(point); }}
          className={cx(
            'text-caption font-semibold text-accent-blue transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-45',
            stacked ? 'min-h-[40px] self-start' : 'absolute left-[23px] top-[291px]',
          )}
        >
          Открыть в сети ›
        </button>
      </>
    );

  const top =
    experiment.best_points.length === 0 ? (
      <p
        className={cx(
          'text-caption text-ink-secondary',
          !stacked && 'absolute left-[23px] top-[355px] w-[443px]',
        )}
      >
        Пока ни одна точка не посчитана: список появится по мере готовности прогонов.
      </p>
    ) : (
      <div className={stacked ? 'flex flex-col' : undefined}>
        {/* Заголовки колонок не переносятся и растут вверх от разделителя: на ужатом
            полотне «МАКС. ОКНО» не помещалось в 90 пикселей и второй строкой ложилось на
            первую строку списка. */}
        <div
          className={cx(
            'grid text-[9px] font-semibold tracking-[0.54px] text-ink-muted',
            stacked ? 'px-[6px] pb-[4px]' : 'absolute left-[23px] w-[443px] whitespace-nowrap',
          )}
          style={
            stacked
              ? { gridTemplateColumns: columns }
              : { gridTemplateColumns: columns, top: bottomAnchoredTop(355, 13.5) }
          }
        >
          <span>#</span>
          <span>КОНФИГУРАЦИЯ</span>
          <span>MIN ДОСТ.</span>
          <span>МАКС. ОКНО</span>
        </div>
        <div
          className={cx('h-px bg-line-divider', !stacked && 'absolute left-[23px] top-[371px] w-[443px]')}
        />

        <ul
          className={cx(
            stacked ? 'mt-[4px]' : 'scroll-area absolute left-[17px] top-[379px] max-h-[170px] w-[455px] pr-[6px]',
          )}
        >
          {experiment.best_points.slice(0, 5).map((best, index) => (
            <li key={best.id}>
              <button
                type="button"
                onClick={() => { onSelect(best); }}
                title={pointTitle(best, axisTitle)}
                className={cx(
                  'grid w-full items-center rounded-sm px-[6px] text-left',
                  // Высота минимальная, а не точная: не поместившаяся в строку точка переносится
                  // между осями, а не теряет цифры под многоточием.
                  stacked ? 'min-h-[44px] py-[4px]' : 'min-h-[34px] py-[2px]',
                  'transition-colors duration-150 hover:bg-surface-chip',
                  best.id === point?.id && 'bg-surface-row-active',
                )}
                style={{ gridTemplateColumns: columns }}
              >
                <span className="text-caption font-semibold text-ink-muted">{index + 1}</span>
                <span className="line-clamp-2 pr-[10px] text-[13px] font-medium leading-tight text-ink-primary">
                  {pointLabel(best, axisLabel)}
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
      </div>
    );

  const budgetWarning = budgetLow && (
    <div
      className={cx(
        'overflow-hidden rounded-sm border',
        stacked
          ? 'grid grid-cols-[15px_minmax(0,1fr)] gap-x-[8px] gap-y-[2px] px-[13px] py-[8px]'
          : 'absolute left-[23px] top-[559px] h-[52px] w-[443px]',
      )}
      style={{
        background: 'var(--status-warning-soft)',
        borderColor: 'var(--status-warning-border)',
      }}
    >
      <AlertCircle
        aria-hidden="true"
        className={cx(
          'size-[15px] text-status-warning',
          stacked ? 'mt-[2px]' : 'absolute left-[13px] top-[9px]',
        )}
      />
      <p
        className={cx(
          'text-caption font-semibold text-status-warning',
          !stacked && 'absolute left-[35px] top-[7px]',
        )}
      >
        Бюджет почти исчерпан: {experiment.completed_points} из {experiment.budget.max_points}{' '}
        прогонов
      </p>
      {/* На полотне пояснение — одна строка в плашке фиксированной высоты: подросший на
          ноутбуке кегль переносил «автоматически» за нижний край, где его срезала рамка, а
          многоточие съедало саму суть. Короткая фраза помещается в строку целиком. */}
      <p
        className={cx(
          'text-[11px] text-ink-muted',
          stacked ? 'col-start-2' : 'absolute left-[35px] right-[13px] top-[27px] whitespace-nowrap',
        )}
      >
        на {experiment.budget.max_points}-м прогоне эксперимент остановится сам
      </p>
    </div>
  );

  if (stacked) {
    return (
      <Card className={cx('flex flex-col gap-[12px] p-[20px]', stackedClassName)}>
        {sectionLabel('ВЫБРАННАЯ ТОЧКА', '')}
        {selected}
        <div className="h-px bg-line-divider" />
        {sectionLabel('ТОП-5 КОНФИГУРАЦИЙ', '')}
        {top}
        {budgetWarning}
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[656px] w-[491px]"
      style={{ left: LEFT, top: TOP }}
    >
      {sectionLabel('ВЫБРАННАЯ ТОЧКА', 'top-[19px]')}
      {selected}
      <div className="absolute left-[23px] top-[313px] h-px w-[443px] bg-line-divider" />
      {sectionLabel('ТОП-5 КОНФИГУРАЦИЙ', 'top-[331px]')}
      {top}
      {budgetWarning}
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
  left?: number;
  top?: number;
  value: string;
  caption: string;
  good: boolean;
}) {
  const positioned = left !== undefined && top !== undefined;

  return (
    <div
      className={cx(
        'overflow-hidden rounded-sm border border-line-divider bg-surface-sunken',
        positioned ? 'absolute h-[54px] w-[212px]' : 'min-w-0 px-[13px] py-[6px]',
      )}
      style={positioned ? { left, top } : undefined}
    >
      <p
        className={cx(
          'truncate text-[18px] font-bold',
          positioned && 'absolute left-[13px] top-[5px]',
          good ? 'text-status-success' : 'text-ink-primary',
        )}
        data-numeric
      >
        {value}
      </p>
      <p className={cx('text-[11px] text-ink-muted', positioned && 'absolute left-[13px] top-[31px]')}>
        {caption}
      </p>
    </div>
  );
}
