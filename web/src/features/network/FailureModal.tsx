import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { GatewayOutage, SatelliteFailure, Scenario } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';
import { formatTick } from '@/lib/run-format';
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

/** Одна высота, один радиус и одни отступы полей — те же, что в модале ошибок сценария. */
const FIELD = 'h-[52px] w-full rounded-md border border-line bg-surface-input px-4 text-base';

/**
 * Модал «Отказ спутника» (`14_SCREENS.md` §2.5, узел макета `133:1628`). Границы задаются
 * началом и длительностью, конец считается и показывается только для чтения — так
 * исключительная правая граница не превращается в вопрос «а 18:00 входит?».
 */
export function FailureModal({ scenario, presetSatelliteId, onClose, onAdd }: FailureModalProps) {
  const stepS = scenario.environment.step_s;
  const horizonS = scenario.environment.horizon_s;
  const gateways = gatewaySites(scenario);
  const stacked = useStacked();

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
      found.push(`Интервал должен укладываться в горизонт ${formatTick(horizonS)}`);
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
      // Список объекта раскрывается панелью поверх формы: прокрутка тела окна обрезала бы
      // её по своему краю, а содержимое этого окна и так помещается целиком.
      scrollBody={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          {/* На телефоне пара кнопок не помещается в строку и переносится целиком. */}
          <div className={cx('flex gap-4', stacked && 'flex-wrap')}>
            <Button
              variant="secondary"
              disabled={problems.length > 0}
              onClick={() => { submit(true); }}
              className={stacked ? 'grow' : undefined}
            >
              Добавить и ещё один
            </Button>
            <Button
              disabled={problems.length > 0}
              onClick={() => { submit(false); }}
              className={stacked ? 'grow' : undefined}
            >
              Добавить
            </Button>
          </div>
        </>
      }
    >
      <Field label="Тип отказа">
        <div className="flex h-[52px] items-center gap-[2px] rounded-md border border-line-subtle bg-surface-track p-1">
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
                'h-full flex-1 rounded-sm text-small font-semibold transition-colors duration-150',
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
          <Select
            label="Аппарат"
            value={satelliteId}
            onChange={setSatelliteId}
            placeholder="Аппаратов в сценарии нет"
            triggerClassName={cx(FIELD, 'font-medium text-ink-primary hover:border-line-strong')}
            options={scenario.design.satellites.map((item) => ({
              value: item.id,
              title: item.id,
              meta: `плоскость ${item.plane_id} · очередь ${item.launch_batch}`,
            }))}
          />
        ) : (
          <Select
            label="Шлюз"
            value={gatewayId}
            onChange={setGatewayId}
            placeholder="Шлюзов в сценарии нет"
            triggerClassName={cx(FIELD, 'font-medium text-ink-primary hover:border-line-strong')}
            options={gateways.map((item) => ({ value: item.id, title: item.id, meta: item.name }))}
          />
        )}
      </Field>

      {/* Три поля одного размера в ряду, под ними — ползунки тех двух, что правятся. На
          телефоне ряд из трёх полей не помещается: поля идут столбцом, и ползунок стоит
          сразу под своим полем, а не через одно. */}
      <div className={cx('mt-4 grid gap-4', stacked ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-3')}>
        <Field label="Начало" inGrid className={stacked ? 'order-1 sm:order-none' : undefined}>
          <ClockInput label="Начало" valueS={startS} stepS={stepS} onChange={setStartS} />
        </Field>
        <Field label="Длительность" inGrid className={stacked ? 'order-3 sm:order-none' : undefined}>
          <ClockInput label="Длительность" valueS={durationS} stepS={stepS} onChange={setDurationS} />
        </Field>
        <Field label="Окончание" inGrid className={stacked ? 'order-5 sm:order-none' : undefined}>
          <p className={cx(FIELD, 'flex items-center text-ink-secondary')} data-numeric>
            {formatTick(endS)}
          </p>
        </Field>

        <Slider
          className={stacked ? '-mt-2 order-2 sm:order-none sm:mt-0' : undefined}
          label="Начало по шкале суток"
          valueS={startS}
          stepS={stepS}
          maxS={horizonS - stepS}
          onChange={setStartS}
        />
        <Slider
          className={stacked ? '-mt-2 order-4 sm:order-none sm:mt-0' : undefined}
          label="Длительность по шкале суток"
          valueS={durationS}
          stepS={stepS}
          maxS={horizonS - startS}
          onChange={setDurationS}
        />
        <p
          className={cx(
            'flex items-center text-caption text-ink-muted',
            stacked ? 'order-6 min-h-[40px] sm:order-none sm:h-[52px]' : 'h-[52px]',
          )}
        >
          Граница исключая: в {formatTick(endS)} аппарат уже работает.
        </p>
      </div>

      {inactiveSatellite !== null && kind === 'satellite' && (
        <p className="mt-4 rounded-md border border-[rgba(255,160,92,0.38)] bg-[rgba(255,160,92,0.14)] px-4 py-3 text-small text-status-warning">
          {inactiveSatellite.id} не активен на этапе {scenario.design.launch_stage} (очередь{' '}
          {inactiveSatellite.launch_batch}) — отказ не повлияет на расчёт
        </p>
      )}

      {problems.length > 0 && (
        <ul className="mt-4 space-y-2">
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

function Field({
  label,
  inGrid = false,
  className,
  children,
}: {
  label: string;
  /** В ряду из трёх полей отступ сверху задаёт сетка, а не само поле. */
  inGrid?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cx(inGrid ? 'block min-w-0' : 'mt-4 block first:mt-0', className)}>
      <span className="mb-2 block truncate text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted" title={label}>
        {label}
      </span>
      {children}
    </div>
  );
}

/** Момент в `ЧЧ:ММ`: значение округляется до шага сетки, на котором считается расчёт. */
function ClockInput({
  label,
  valueS,
  stepS,
  onChange,
}: {
  label: string;
  valueS: number;
  stepS: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={formatTick(valueS)}
      onChange={(event) => {
        const parsed = parseClock(event.target.value);
        if (parsed !== null) {
          onChange(Math.round(parsed / stepS) * stepS);
        }
      }}
      className={cx(FIELD, 'text-ink-primary transition-colors duration-150 focus:border-line-strong')}
      data-numeric
    />
  );
}

function Slider({
  label,
  valueS,
  stepS,
  maxS,
  className,
  onChange,
}: {
  className?: string | undefined;
  label: string;
  valueS: number;
  stepS: number;
  maxS: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className={cx('flex h-[52px] items-center', className)}>
      <input
        type="range"
        min={0}
        max={Math.max(maxS, 0)}
        step={stepS}
        value={Math.min(valueS, Math.max(maxS, 0))}
        onChange={(event) => { onChange(Number(event.target.value)); }}
        className="w-full accent-[var(--accent-violet)]"
        aria-label={label}
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
