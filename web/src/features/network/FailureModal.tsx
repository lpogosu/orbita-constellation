import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { GatewayOutage, SatelliteFailure, Scenario } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cx } from '@/lib/cx';
import { formatClock } from '@/timeline/segments';
import { gatewaySites } from './draft';

export type FailureDraft =
  | { readonly kind: 'satellite'; readonly value: SatelliteFailure }
  | { readonly kind: 'gateway'; readonly value: GatewayOutage };

interface FailureModalProps {
  readonly scenario: Scenario;
  /** Аппарат, выбранный на карте: модал открывается уже заполненным. */
  readonly presetSatelliteId?: string | null;
  readonly onClose: () => void;
  readonly onAdd: (failure: FailureDraft, keepOpen: boolean) => void;
}

/**
 * Модал «Отказ спутника» (`14_SCREENS.md` §2.5, узел макета `133:1628`). Границы задаются
 * началом и длительностью, конец считается и показывается только для чтения — так
 * исключительная правая граница не превращается в вопрос «а 18:00 входит?».
 */
export function FailureModal({ scenario, presetSatelliteId, onClose, onAdd }: FailureModalProps) {
  const stepS = scenario.environment.step_s;
  const horizonS = scenario.environment.horizon_s;
  const gateways = gatewaySites(scenario);

  const [kind, setKind] = useState<'satellite' | 'gateway'>('satellite');
  const [satelliteId, setSatelliteId] = useState(
    presetSatelliteId ?? scenario.design.satellites[0]?.id ?? '',
  );
  const [gatewayId, setGatewayId] = useState(gateways[0]?.id ?? '');
  const [startS, setStartS] = useState(0);
  const [durationS, setDurationS] = useState(Math.min(3600, horizonS));

  const endS = startS + durationS;

  const satellite = scenario.design.satellites.find((item) => item.id === satelliteId);
  const inactiveSatellite =
    satellite !== undefined && satellite.launch_batch > scenario.design.launch_stage
      ? satellite
      : null;

  const problems = useMemo(() => {
    const found: string[] = [];
    if (durationS <= 0) {
      found.push('Конец должен быть больше начала');
    }
    if (startS < 0 || endS > horizonS) {
      found.push(`Интервал должен укладываться в горизонт ${formatClock(horizonS)}`);
    }
    if (startS % stepS !== 0 || durationS % stepS !== 0) {
      found.push(`Начало и длительность кратны шагу сетки ${stepS} с`);
    }
    if (kind === 'satellite' && satelliteId === '') {
      found.push('Выберите аппарат');
    }
    if (kind === 'gateway' && gatewayId === '') {
      found.push('Выберите шлюз');
    }
    return found;
  }, [durationS, startS, endS, horizonS, stepS, kind, satelliteId, gatewayId]);

  const submit = (keepOpen: boolean): void => {
    if (problems.length > 0) {
      return;
    }
    onAdd(
      kind === 'satellite'
        ? { kind: 'satellite', value: { satellite_id: satelliteId, start_s: startS, end_s: endS } }
        : { kind: 'gateway', value: { gateway_id: gatewayId, start_s: startS, end_s: endS } },
      keepOpen,
    );
  };

  return (
    <Modal
      title={kind === 'satellite' ? 'Добавить отказ аппарата' : 'Добавить недоступность шлюза'}
      subtitle="Отказ попадёт в черновик варианта — расчёт запускается отдельно"
      align="start"
      width={760}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <div className="flex gap-4">
            <Button variant="secondary" disabled={problems.length > 0} onClick={() => { submit(true); }}>
              Добавить и ещё один
            </Button>
            <Button disabled={problems.length > 0} onClick={() => { submit(false); }}>
              Добавить
            </Button>
          </div>
        </>
      }
    >
      <Field label="Тип отказа">
        <div className="flex h-[46px] items-center gap-[2px] rounded-sm border border-line-subtle bg-surface-track p-[3px]">
          {(
            [
              ['satellite', 'Спутник'],
              ['gateway', 'Шлюз'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => { setKind(value); }}
              className={cx(
                'h-[38px] flex-1 rounded-[10px] text-small font-semibold transition-colors duration-150',
                kind === value ? 'bg-accent-violet text-ink-onAccent' : 'text-ink-secondary',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Объект">
        {kind === 'satellite' ? (
          <select
            value={satelliteId}
            onChange={(event) => { setSatelliteId(event.target.value); }}
            className="h-[48px] w-full rounded-sm border border-line bg-surface-input px-[15px] text-base text-ink-primary"
          >
            {scenario.design.satellites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · плоскость {item.plane_id} · очередь {item.launch_batch}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={gatewayId}
            onChange={(event) => { setGatewayId(event.target.value); }}
            className="h-[48px] w-full rounded-sm border border-line bg-surface-input px-[15px] text-base text-ink-primary"
          >
            {gateways.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid grid-cols-3 gap-[20px]">
        <Field label="Начало">
          <TimeInput valueS={startS} stepS={stepS} maxS={horizonS - stepS} onChange={setStartS} />
        </Field>
        <Field label="Длительность">
          <TimeInput
            valueS={durationS}
            stepS={stepS}
            maxS={horizonS - startS}
            onChange={setDurationS}
          />
        </Field>
        <Field label="Окончание">
          <p className="flex h-[48px] items-center rounded-sm border border-line bg-surface-sunken px-[15px] text-base text-ink-secondary" data-numeric>
            {formatClock(endS)} <span className="ml-[8px] text-caption text-ink-muted">исключая</span>
          </p>
        </Field>
      </div>

      {inactiveSatellite !== null && kind === 'satellite' && (
        <p className="mt-[16px] rounded-sm border border-[rgba(255,160,92,0.38)] bg-[rgba(255,160,92,0.14)] px-[15px] py-[11px] text-small text-status-warning">
          {inactiveSatellite.id} не активен на этапе {scenario.design.launch_stage} (очередь{' '}
          {inactiveSatellite.launch_batch}) — отказ не повлияет на расчёт
        </p>
      )}

      {problems.length > 0 && (
        <ul className="mt-[16px] space-y-[6px]">
          {problems.map((problem) => (
            <li key={problem} className="text-small text-status-danger">
              {problem}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-[16px] block first:mt-0">
      <span className="mb-[8px] block text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Ввод момента в `ЧЧ:ММ` с шагом сетки: ползунок по суткам и поле рядом. */
function TimeInput({
  valueS,
  stepS,
  maxS,
  onChange,
}: {
  valueS: number;
  stepS: number;
  maxS: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="block">
      <input
        type="text"
        inputMode="numeric"
        value={formatClock(valueS)}
        onChange={(event) => {
          const parsed = parseClock(event.target.value);
          if (parsed !== null) {
            onChange(Math.round(parsed / stepS) * stepS);
          }
        }}
        className="h-[48px] w-full rounded-sm border border-line bg-surface-input px-[15px] text-base text-ink-primary"
        data-numeric
      />
      <input
        type="range"
        min={0}
        max={Math.max(maxS, 0)}
        step={stepS}
        value={Math.min(valueS, Math.max(maxS, 0))}
        onChange={(event) => { onChange(Number(event.target.value)); }}
        className="mt-[10px] w-full accent-[var(--accent-violet)]"
        aria-label="Ползунок по шкале суток"
      />
    </span>
  );
}

function parseClock(text: string): number | null {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}
