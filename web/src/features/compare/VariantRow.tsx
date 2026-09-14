import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import type { ComparisonEntry, RoutingPolicy } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import { deltaArrow, formatPoints } from '@/lib/measures';
import { formatShare, policyLabel, ROUTING_POLICIES, variantLetter } from '@/lib/run-format';
import { deltaToneClass } from './metrics';
import { pickRun } from './runs';
import type { VariantRuns } from './runs';
import { MAX_SLOTS, slotColor } from './slots';

const ROW_TOP = 166;
const SLOT_STEP = 471;
const SLOT_LEFT = 26;

export type CompareMode = 'variants' | 'policies';

interface VariantRowProps {
  readonly mode: CompareMode;
  readonly groups: readonly VariantRuns[];
  readonly runIds: readonly string[];
  readonly entries: readonly ComparisonEntry[] | null;
  /** Сравнение запрошено и ещё не пришло: иначе карточке без данных нечего обещать. */
  readonly comparing: boolean;
  readonly busyVariantId: string | null;
  readonly onChange: (runIds: readonly string[]) => void;
  readonly onCalculate: (variantId: string, policy: RoutingPolicy) => void;
}

/**
 * Строка «Сравниваем: …». В режиме «Варианты» каждая карточка — свой вариант проекта,
 * в режиме «Политики» — один вариант, посчитанный разными политиками маршрутизации
 * (`14_SCREENS.md` §6). Первая карточка всегда база: относительно неё сервис считает дельты.
 */
export function VariantRow({
  mode,
  groups,
  runIds,
  entries,
  comparing,
  busyVariantId,
  onChange,
  onCalculate,
}: VariantRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const stacked = useStacked();

  const remove = (runId: string): void => {
    onChange(runIds.filter((id) => id !== runId));
  };

  const add = (runId: string): void => {
    setPickerOpen(false);
    if (!runIds.includes(runId)) {
      onChange([...runIds, runId]);
    }
  };

  const row = (
    <>
      {runIds.map((runId, index) => (
        <VariantChip
          key={runId}
          stacked={stacked}
          comparing={comparing}
          index={index}
          left={SLOT_LEFT + index * SLOT_STEP}
          entry={entries?.find((item) => item.run_id === runId) ?? null}
          onRemove={index === 0 ? null : () => { remove(runId); }}
        />
      ))}

      {runIds.length < MAX_SLOTS && (
        <button
          type="button"
          aria-expanded={pickerOpen}
          onClick={() => { setPickerOpen((open) => !open); }}
          className={cx(
            'h-[88px] rounded-lg border border-dashed border-line',
            stacked ? 'w-full' : 'absolute w-[455px]',
            'flex items-center justify-center gap-3 text-ink-secondary',
            'transition-colors duration-150 hover:border-line-strong hover:text-ink-primary',
          )}
          style={stacked ? undefined : { left: SLOT_LEFT + runIds.length * SLOT_STEP, top: ROW_TOP }}
        >
          <Plus aria-hidden="true" className="size-[18px]" />
          <span className="text-[17px] font-semibold">
            {mode === 'variants' ? 'Добавить вариант' : 'Добавить политику'}
          </span>
        </button>
      )}

    </>
  );

  const picker = pickerOpen && (
    <RunPicker
      stacked={stacked}
      mode={mode}
      groups={groups}
      runIds={runIds}
      busyVariantId={busyVariantId}
      onPick={add}
      onCalculate={onCalculate}
      onClose={() => { setPickerOpen(false); }}
    />
  );

  if (stacked) {
    return (
      <>
        <div className="grid gap-[16px] md:col-span-2 md:grid-cols-2">{row}</div>
        {picker}
      </>
    );
  }

  return (
    <>
      {row}
      {picker}
    </>
  );
}

function VariantChip({
  stacked,
  comparing,
  index,
  left,
  entry,
  onRemove,
}: {
  stacked: boolean;
  comparing: boolean;
  index: number;
  left: number;
  entry: ComparisonEntry | null;
  onRemove: (() => void) | null;
}) {
  const isBase = index === 0;
  const delta = entry?.deltas['min_client_availability'];

  return (
    <Card
      sceneX={left}
      sceneY={ROW_TOP}
      className={cx(
        'h-[88px] rounded-lg',
        stacked ? 'relative w-full' : 'absolute w-[455px]',
        isBase && 'border-2 border-accent-violet-light',
      )}
      style={stacked ? undefined : { left, top: ROW_TOP }}
    >
      <span
        aria-hidden="true"
        className="absolute left-[18px] top-[20px] size-[10px] rounded-full"
        style={{ background: slotColor(index) }}
      />
      <p className="absolute left-[36px] top-[15px] text-caption font-semibold text-ink-muted">
        Вариант {variantLetter(index)}
      </p>

      {isBase ? (
        <span className="absolute left-[126px] top-[12px] rounded-pill bg-surface-rowActive px-[9px] py-[3px] text-micro font-semibold tracking-normal text-ink-primary">
          база
        </span>
      ) : (
        onRemove !== null && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Убрать вариант ${variantLetter(index)} из сравнения`}
            className={cx(
              'absolute flex items-center justify-center rounded-sm text-ink-muted transition-colors duration-150 hover:text-ink-primary',
              stacked ? 'left-[108px] top-0 size-[40px]' : 'left-[124px] top-[11px] p-[2px]',
            )}
          >
            <X aria-hidden="true" className="size-[14px]" />
          </button>
        )
      )}

      {entry === null ? (
        <p className="absolute left-[18px] top-[36px] text-small text-ink-secondary">
          {comparing ? 'Запуск выбран, сравнение считается…' : 'Запуск выбран, сравнения пока нет'}
        </p>
      ) : (
        <>
          <p
            title={entry.variant_title}
            className={cx(
              'absolute left-[18px] top-[34px] truncate text-[16px] font-semibold text-ink-primary',
              // Справа стоит доступность шириной около 120px: заголовок до неё не доходит.
              stacked ? 'max-w-[calc(100%-160px)]' : 'max-w-[280px]',
            )}
          >
            {entry.variant_title}
          </p>
          <span className="absolute left-[18px] top-[58px] rounded-[7px] bg-surface-chip px-[8px] py-[3px] text-micro font-medium tracking-normal text-ink-secondary">
            {policyLabel(entry.routing_policy)}
          </span>
          <p
            className="absolute right-[22px] top-[28px] text-title-m font-bold text-ink-primary"
            data-numeric
          >
            {formatShare(entry.config.min_client_availability)}
          </p>
          <p className="absolute right-[22px] top-[56px] text-[10px] text-ink-muted">
            min доступность
          </p>
          {delta !== undefined && (
            <p
              className={cx(
                'absolute right-[22px] top-[12px] text-[11px] font-semibold',
                deltaToneClass(delta, 'up'),
              )}
              data-numeric
            >
              {deltaArrow(delta)} {formatPoints(delta)}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function RunPicker({
  stacked,
  mode,
  groups,
  runIds,
  busyVariantId,
  onPick,
  onCalculate,
  onClose,
}: {
  stacked: boolean;
  mode: CompareMode;
  groups: readonly VariantRuns[];
  runIds: readonly string[];
  busyVariantId: string | null;
  onPick: (runId: string) => void;
  onCalculate: (variantId: string, policy: RoutingPolicy) => void;
  onClose: () => void;
}) {
  const baseVariant = groups.find((group) => group.runs.some((run) => run.id === runIds[0]));
  const offered =
    mode === 'policies' && baseVariant !== undefined ? [baseVariant] : [...groups];

  return (
    <>
      <button
        type="button"
        aria-label="Закрыть список вариантов"
        onClick={onClose}
        className={cx('cursor-default', stacked ? 'fixed inset-0 z-10' : 'absolute inset-0')}
      />
      <Card
        sceneX={SLOT_LEFT}
        sceneY={262}
        className={cx(
          'p-[18px]',
          // В потоке список раскрывается под строкой вариантов и поверх подложки закрытия.
          stacked ? 'relative z-20' : 'absolute left-[26px] top-[262px] z-10 w-[560px]',
        )}
      >
        <p className="text-micro font-semibold tracking-wide text-ink-muted">
          {mode === 'variants' ? 'ВАРИАНТЫ ПРОЕКТА' : 'ПОЛИТИКИ ЭТОГО ВАРИАНТА'}
        </p>
        <ul className="scroll-area mt-[12px] max-h-[420px] pr-[6px]">
          {offered.map((group) => (
            <li key={group.variant.id} className="border-b border-line-divider py-[10px] last:border-0">
              <p className="text-small font-semibold text-ink-primary">{group.variant.title}</p>
              <div className="mt-[8px] flex flex-wrap gap-[8px]">
                {ROUTING_POLICIES.map((policy) => {
                  const run = pickRun(group, policy);
                  const chosen = run !== undefined && runIds.includes(run.id);
                  const calculating = busyVariantId === group.variant.id;

                  if (run === undefined) {
                    return (
                      <button
                        key={policy}
                        type="button"
                        disabled={calculating}
                        onClick={() => { onCalculate(group.variant.id, policy); }}
                        className={cx(
                          'rounded-sm border border-dashed border-line px-[10px] py-[6px] text-left text-caption',
                          stacked && 'min-h-[40px]',
                          'text-ink-muted transition-colors duration-150',
                          'hover:border-line-strong hover:text-ink-secondary',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                        )}
                      >
                        нет расчёта · Рассчитать с политикой «{policyLabel(policy)}»
                      </button>
                    );
                  }

                  return (
                    <button
                      key={policy}
                      type="button"
                      disabled={chosen}
                      onClick={() => { onPick(run.id); }}
                      className={cx(
                        'rounded-sm border px-[10px] py-[6px] text-caption font-medium',
                        stacked && 'min-h-[40px]',
                        'transition-colors duration-150',
                        chosen
                          ? 'cursor-not-allowed border-line-strong bg-surface-rowActive text-ink-primary'
                          : 'border-line text-ink-secondary hover:border-line-strong hover:text-ink-primary',
                      )}
                    >
                      {policyLabel(policy)}
                      {chosen ? ' · уже в сравнении' : ''}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        {offered.length === 0 && (
          <p className="py-[12px] text-small text-ink-secondary">
            У проекта нет других вариантов. Сохраните вариант на экране «Сеть».
          </p>
        )}
      </Card>
    </>
  );
}
