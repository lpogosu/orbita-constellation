import { AlertTriangle } from 'lucide-react';

import type { ComparisonEntry, ParameterChange } from '@/api/types';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { slotLetter } from './slots';

const LEFT = 1202;
const TOP = 266;

/** Путь в сценарии, по которому расходятся условия расчёта, а не устройство группировки. */
const ENVIRONMENT_PREFIX = 'environment.';

/**
 * «Изменённые параметры» (узел Figma `46:553`). Таблица собирается из `changed_parameters`
 * ответа сравнения — сервис считает их по каноническим сценариям вариантов, — поэтому
 * ничего вписывать руками здесь нельзя.
 */
export function ChangedParametersCard({ entries }: { entries: readonly ComparisonEntry[] }) {
  const base = entries[0];
  if (base === undefined) {
    return null;
  }

  const candidates = entries.slice(1);
  const paths = orderedPaths(candidates);
  const mixedConditions = paths.some((path) => path.startsWith(ENVIRONMENT_PREFIX));

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[288px] w-[692px]"
      style={{ left: LEFT, top: TOP }}
    >
      <h2 className="absolute left-[27px] top-[17px] text-title-m font-semibold text-ink-primary">
        Изменённые параметры
      </h2>

      {paths.length === 0 ? (
        <div className="absolute inset-x-[27px] bottom-[24px] top-[56px]">
          <EmptyState
            title="Сценарии совпадают"
            hint="Варианты различаются только политикой маршрутизации: в канонических сценариях нет ни одного расхождения."
          />
        </div>
      ) : (
        <div className="absolute inset-x-[27px] top-[56px] h-[184px]">
          <div
            className="grid gap-x-[12px] pb-[6px] text-[10px] font-semibold tracking-[0.7px] text-ink-muted"
            style={{ gridTemplateColumns: template(candidates.length) }}
          >
            <span>ПАРАМЕТР</span>
            <span className="truncate">{slotLetter(0)} · база</span>
            {candidates.map((entry, index) => (
              <span key={entry.run_id} className="truncate">
                {slotLetter(index + 1)} · {entry.variant_title}
              </span>
            ))}
          </div>
          <div className="h-px w-full bg-line-divider" />

          <ul className="scroll-area max-h-[150px] pr-[6px]">
            {paths.map((path) => (
              <li
                key={path}
                className="grid items-center gap-x-[12px] border-b border-line-divider py-[8px] last:border-0"
                style={{ gridTemplateColumns: template(candidates.length) }}
              >
                <span className="break-words font-mono text-[12px] text-ink-secondary">{path}</span>
                <span className="text-[13px] text-ink-primary" data-numeric>
                  {baseValue(candidates, path)}
                </span>
                {candidates.map((entry) => (
                  <span key={entry.run_id} className="text-[13px] text-ink-primary" data-numeric>
                    {show(entry.changed_parameters.find((change) => change.path === path)?.to)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mixedConditions && (
        <p className="absolute inset-x-[27px] bottom-[36px] flex items-start gap-[8px] text-[11px] text-status-warning">
          <AlertTriangle aria-hidden="true" className="mt-[1px] size-[13px] shrink-0" />
          Варианты с разными условиями расчёта: сопоставление ориентировочно.
        </p>
      )}

      <p className="absolute left-[27px] bottom-[14px] text-[11px] text-ink-muted">
        источник: сравнение канонических сценариев · база — {base.variant_title}
      </p>
    </Card>
  );
}

/** Порядок путей — тот, в котором их вернул сервис; повторы между вариантами убраны. */
function orderedPaths(candidates: readonly ComparisonEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of candidates) {
    for (const change of entry.changed_parameters) {
      if (!paths.includes(change.path)) {
        paths.push(change.path);
      }
    }
  }
  return paths;
}

/**
 * Значение базы приходит полем `from` у любого варианта, где этот путь изменён: сервис
 * сравнивает каждый вариант именно с базой, поэтому `from` у них совпадает.
 */
function baseValue(candidates: readonly ComparisonEntry[], path: string): string {
  for (const entry of candidates) {
    const change = entry.changed_parameters.find((item) => item.path === path);
    if (change !== undefined) {
      return show(change.from);
    }
  }
  return '—';
}

function show(value: ParameterChange['from'] | undefined): string {
  if (value === undefined || value === null) {
    return '—';
  }
  return typeof value === 'boolean' ? (value ? 'да' : 'нет') : String(value);
}

function template(candidates: number): string {
  return `minmax(150px, 1.4fr) repeat(${candidates + 1}, minmax(90px, 1fr))`;
}
