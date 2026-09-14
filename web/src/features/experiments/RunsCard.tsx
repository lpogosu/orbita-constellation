import { Check, History } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Experiment, ExperimentPoint, RoutingPolicy } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatShareShort } from '@/lib/measures';
import { formatGap, policyLabel } from '@/lib/run-format';
import { pointLabel, pointTitle } from './points';
import type { AxisLabel } from './points';

const LEFT = 25;
const TOP = 872;
const COLUMNS = '46px 260px 150px 140px 160px 180px 150px 280px 1fr';
/**
 * В потоке таблица не сжимается под колонку: восемь столбцов в 358 пикселях нечитаемы.
 * Она сохраняет рабочую ширину и прокручивается внутри карточки.
 */
const STACKED_COLUMNS = '40px 240px 110px 90px 100px 120px 110px 290px';

interface RunsCardProps {
  readonly experiment: Experiment | null;
  readonly points: readonly ExperimentPoint[];
  readonly policy: RoutingPolicy;
  readonly selectedPointId: string | null;
  readonly axisTitle: (path: string) => string;
  /** Короткие подписи осей для видимой строки; полные названия остаются в подсказке. */
  readonly axisLabel: (path: string) => AxisLabel;
  readonly onSelect: (point: ExperimentPoint) => void;
  readonly onMaterialize: (point: ExperimentPoint) => void;
  readonly onCompare: (point: ExperimentPoint) => void;
  readonly onOpenNetwork: (point: ExperimentPoint) => void;
  readonly children?: ReactNode;
  /** Место карточки в сетке потока; на полотне не используется. */
  readonly stackedClassName?: string;
}

/**
 * «Прогоны эксперимента» (узел Figma `146:1137`). Точка без `run_id` ещё считается: её
 * показатели — прочерки, а действия недоступны, потому что открывать и материализовать
 * пока нечего.
 */
export function RunsCard({
  experiment,
  points,
  policy,
  selectedPointId,
  axisTitle,
  axisLabel,
  onSelect,
  onMaterialize,
  onCompare,
  onOpenNetwork,
  children,
  stackedClassName,
}: RunsCardProps) {
  const stacked = useStacked();
  const columns = stacked ? STACKED_COLUMNS : COLUMNS;

  const heading = (
    <>
      <h2
        className={cx(
          'text-[18px] font-semibold text-ink-primary',
          !stacked && 'absolute left-[23px] top-[13px]',
        )}
      >
        Прогоны эксперимента
      </h2>
      {experiment !== null && (
        <p className={cx('text-caption text-ink-secondary', !stacked && 'absolute left-[259px] top-[19px]')}>
          {experiment.completed_points} из {experiment.total_points} · результаты появляются по
          мере готовности
        </p>
      )}
    </>
  );

  const table = (
    <>
      <div
        className={cx(
          'grid text-[9px] font-semibold tracking-[0.54px] text-ink-muted',
          stacked ? 'px-[6px] pb-[6px]' : 'absolute left-[23px] top-[51px] w-[1810px]',
        )}
        style={{ gridTemplateColumns: columns }}
      >
        <span>#</span>
        <span>КОНФИГУРАЦИЯ</span>
        <span>ПОЛИТИКА</span>
        <span>MIN ДОСТ.</span>
        <span>МАКС. ОКНО</span>
        <span>СРЕДНЯЯ ДОСТ.</span>
        <span>СТАТУС</span>
        <span>ДЕЙСТВИЯ</span>
        {!stacked && <span />}
      </div>
      <div className={cx('h-px bg-line-divider', !stacked && 'absolute left-[23px] top-[67px] w-[1810px]')} />

      <ul
        className={
          stacked ? 'mt-[4px]' : 'scroll-area absolute left-[17px] top-[75px] max-h-[96px] w-[1828px] pr-[6px]'
        }
      >
        {points.map((point, index) => {
          const ready = point.run_id !== null && point.run_id !== undefined;
          return (
            <li
              key={point.id}
              className={cx(
                'grid items-center rounded-[7px] px-[6px]',
                stacked ? 'h-[44px]' : 'h-[26px]',
                point.id === selectedPointId && 'bg-surface-row-active',
              )}
              style={{ gridTemplateColumns: columns }}
            >
              <span className="text-caption text-ink-muted">{index + 1}</span>
              <button
                type="button"
                onClick={() => { onSelect(point); }}
                title={pointTitle(point, axisTitle)}
                className={cx(
                  'truncate pr-[10px] text-left text-caption font-semibold text-ink-primary hover:underline',
                  stacked && 'h-[40px]',
                )}
              >
                {pointLabel(point, axisLabel)}
              </button>
              <span className="truncate pr-[10px] text-caption text-ink-secondary">
                {policyLabel(policy)}
              </span>
              <span className="text-caption text-ink-secondary" data-numeric>
                {point.min_client_availability === null ||
                point.min_client_availability === undefined
                  ? '—'
                  : formatShareShort(point.min_client_availability)}
              </span>
              <span className="text-caption text-ink-secondary" data-numeric>
                {point.worst_max_gap_s === null || point.worst_max_gap_s === undefined
                  ? '—'
                  : formatGap(point.worst_max_gap_s)}
              </span>
              <span className="text-caption text-ink-secondary" data-numeric>
                {point.mean_client_availability === null ||
                point.mean_client_availability === undefined
                  ? '—'
                  : formatShareShort(point.mean_client_availability)}
              </span>
              <span
                className={cx(
                  'flex items-center gap-[6px] text-caption font-semibold',
                  ready ? 'text-status-success' : 'text-accent-violet-light',
                )}
              >
                {ready ? (
                  <Check aria-hidden="true" className="size-[12px]" />
                ) : (
                  <History aria-hidden="true" className="size-[12px]" />
                )}
                {ready ? 'готов' : 'считается'}
              </span>
              <span
                className={cx(
                  'flex items-center whitespace-nowrap',
                  stacked ? 'gap-[8px]' : 'gap-[18px]',
                )}
              >
                <RowAction disabled={!ready} onClick={() => { onOpenNetwork(point); }}>
                  Открыть
                </RowAction>
                <RowAction disabled={!ready} onClick={() => { onMaterialize(point); }}>
                  Материализовать
                </RowAction>
                <RowAction disabled={!ready} onClick={() => { onCompare(point); }}>
                  Сравнить
                </RowAction>
              </span>
              {!stacked && <span />}
            </li>
          );
        })}
      </ul>
    </>
  );

  const hasState = children !== undefined && children !== null;

  if (stacked) {
    return (
      <Card className={cx('flex flex-col gap-[4px] p-[20px]', stackedClassName)}>
        <div className="flex flex-wrap items-baseline gap-x-[16px] gap-y-[4px]">{heading}</div>
        {hasState ? (
          <div className="mt-[8px] min-h-[160px]">{children}</div>
        ) : (
          <div className="scroll-area mt-[8px] overflow-x-auto">
            <div className="w-max min-w-full">{table}</div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[184px] w-[1858px]"
      style={{ left: LEFT, top: TOP }}
    >
      {heading}
      {hasState ? (
        <div className="absolute inset-x-[23px] top-[46px] h-[124px]">{children}</div>
      ) : (
        table
      )}
    </Card>
  );
}

function RowAction({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const stacked = useStacked();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'text-caption font-semibold transition-opacity duration-150',
        stacked && 'min-h-[40px] px-[6px]',
        disabled ? 'cursor-not-allowed text-ink-muted opacity-55' : 'text-accent-blue hover:opacity-80',
      )}
    >
      {children}
    </button>
  );
}
