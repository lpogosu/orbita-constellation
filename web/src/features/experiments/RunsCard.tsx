import { Check, History } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Experiment, ExperimentPoint, RoutingPolicy } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { formatShareShort } from '@/lib/measures';
import { formatGap, policyLabel } from '@/lib/run-format';
import { pointTitle } from './points';

const LEFT = 25;
const TOP = 872;
const COLUMNS = '46px 260px 150px 140px 160px 180px 150px 220px 1fr';

interface RunsCardProps {
  readonly experiment: Experiment | null;
  readonly points: readonly ExperimentPoint[];
  readonly policy: RoutingPolicy;
  readonly selectedPointId: string | null;
  readonly axisTitle: (path: string) => string;
  readonly onSelect: (point: ExperimentPoint) => void;
  readonly onMaterialize: (point: ExperimentPoint) => void;
  readonly onCompare: (point: ExperimentPoint) => void;
  readonly onOpenNetwork: (point: ExperimentPoint) => void;
  readonly children?: ReactNode;
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
  onSelect,
  onMaterialize,
  onCompare,
  onOpenNetwork,
  children,
}: RunsCardProps) {
  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[184px] w-[1858px]"
      style={{ left: LEFT, top: TOP }}
    >
      <h2 className="absolute left-[23px] top-[13px] text-[18px] font-semibold text-ink-primary">
        Прогоны эксперимента
      </h2>
      {experiment !== null && (
        <p className="absolute left-[259px] top-[19px] text-caption text-ink-secondary">
          {experiment.completed_points} из {experiment.total_points} · результаты появляются по
          мере готовности
        </p>
      )}

      {children !== undefined && children !== null ? (
        <div className="absolute inset-x-[23px] top-[46px] h-[124px]">{children}</div>
      ) : (
        <>
          <div
            className="absolute left-[23px] top-[51px] grid w-[1810px] text-[9px] font-semibold tracking-[0.54px] text-ink-muted"
            style={{ gridTemplateColumns: COLUMNS }}
          >
            <span>#</span>
            <span>КОНФИГУРАЦИЯ</span>
            <span>ПОЛИТИКА</span>
            <span>MIN ДОСТ.</span>
            <span>МАКС. ОКНО</span>
            <span>СРЕДНЯЯ ДОСТ.</span>
            <span>СТАТУС</span>
            <span>ДЕЙСТВИЯ</span>
            <span />
          </div>
          <div className="absolute left-[23px] top-[67px] h-px w-[1810px] bg-line-divider" />

          <ul className="scroll-area absolute left-[17px] top-[75px] max-h-[96px] w-[1828px] pr-[6px]">
            {points.map((point, index) => {
              const ready = point.run_id !== null && point.run_id !== undefined;
              return (
                <li
                  key={point.id}
                  className={cx(
                    'grid h-[26px] items-center rounded-[7px] px-[6px]',
                    point.id === selectedPointId && 'bg-surface-row-active',
                  )}
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <span className="text-caption text-ink-muted">{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => { onSelect(point); }}
                    className="truncate pr-[10px] text-left text-caption font-semibold text-ink-primary hover:underline"
                  >
                    {pointTitle(point, axisTitle)}
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
                  <span className="flex items-center gap-[18px]">
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
                  <span />
                </li>
              );
            })}
          </ul>
        </>
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
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'text-caption font-semibold transition-opacity duration-150',
        disabled ? 'cursor-not-allowed text-ink-muted opacity-55' : 'text-accent-blue hover:opacity-80',
      )}
    >
      {children}
    </button>
  );
}
