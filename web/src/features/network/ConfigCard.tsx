import { BarChart3, ChevronDown, ChevronRight, Pencil, Rocket, SatelliteDish, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { RoutingPolicy, Run, Scenario, Variant } from '@/api/types';
import { Select } from '@/components/ui/Select';
import { cx } from '@/lib/cx';
import { formatTick } from '@/lib/run-format';
import type { DraftChange } from './draft';
import { withEnvironment, withFailures, withGatewayOutages, withLaunchStage, withPlane } from './draft';
import { STAGE_LABEL, stageStep } from './use-run';

const POLICIES: readonly { value: RoutingPolicy; label: string; hint: string }[] = [
  { value: 'bfs_shortest', label: 'BFS', hint: 'Минимум переходов, маршрут пересчитывается каждый отсчёт' },
  { value: 'persistent', label: 'Удержание', hint: 'Текущий маршрут держится, пока он валиден' },
  { value: 'dijkstra_distance', label: 'Дейкстра', hint: 'Минимальная суммарная длина линий' },
];

const ENVIRONMENT_FIELDS: readonly { key: 'altitude_km' | 'inclination_deg' | 'isl_range_km' | 'min_elevation_deg' | 'horizon_s' | 'step_s'; label: string; unit: string }[] = [
  { key: 'altitude_km', label: 'Высота орбиты', unit: 'км' },
  { key: 'inclination_deg', label: 'Наклонение', unit: '°' },
  { key: 'isl_range_km', label: 'Дальность ISL', unit: 'км' },
  { key: 'min_elevation_deg', label: 'Мин. возвышение', unit: '°' },
  { key: 'horizon_s', label: 'Горизонт', unit: 'с' },
  { key: 'step_s', label: 'Шаг сетки', unit: 'с' },
];

interface ConfigCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly draft: Scenario;
  readonly variants: readonly Variant[];
  readonly variantId: string | null;
  readonly onSelectVariant: (variantId: string) => void;
  readonly onChange: (scenario: Scenario) => void;
  readonly policy: RoutingPolicy;
  readonly onPolicy: (policy: RoutingPolicy) => void;
  readonly changes: readonly DraftChange[];
  readonly onReset: () => void;
  readonly onSaveVariant: () => void;
  readonly onPreview: () => void;
  readonly onAddFailure: () => void;
  readonly run: Run | null;
  readonly runStarting: boolean;
  readonly runError: string | null;
  readonly onRun: () => void;
  readonly onCancelRun: () => void;
}

/** Левая панель экрана «Сеть» (`14_SCREENS.md` §2.1), узел макета `33:289`. */
export function ConfigCard(props: ConfigCardProps) {
  const { draft, changes } = props;
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [conditionsEditable, setConditionsEditable] = useState(false);

  const stages = [1, 2, 3];
  const activeRun =
    props.run !== null && (props.run.status === 'queued' || props.run.status === 'running')
      ? props.run
      : null;

  return (
    <div
      className="card-glass absolute flex flex-col px-[25px] pb-[18px] pt-[13px]"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        backgroundPosition: `0 0, ${-props.x}px ${-props.y}px`,
      }}
    >
      <Select
        label="Вариант"
        value={props.variantId ?? ''}
        options={props.variants.map((variant) => ({ value: variant.id, title: variant.title }))}
        onChange={props.onSelectVariant}
        placeholder="Вариант не выбран"
        triggerClassName="h-[52px] w-full rounded-lg border border-line bg-surface-input pl-[22px] pr-[16px] text-[20px] font-semibold leading-none text-ink-primary hover:border-line-strong"
      />

      <p className="mt-[10px] text-base font-semibold text-ink-primary">Этап запуска</p>
      <div className="mt-[8px] flex h-[44px] items-center gap-[2px] rounded-[14px] border border-line-subtle bg-surface-input p-[3px]">
        {stages.map((stage) => (
          <button
            key={stage}
            type="button"
            aria-pressed={draft.design.launch_stage === stage}
            onClick={() => { props.onChange(withLaunchStage(draft, stage)); }}
            className={cx(
              'h-[36px] flex-1 rounded-[9px] text-title-m font-semibold transition-colors duration-150',
              draft.design.launch_stage === stage
                ? 'bg-accent-violet text-ink-onAccent shadow-glow-violet'
                : 'text-ink-secondary',
            )}
          >
            {stage}
          </button>
        ))}
      </div>

      <div className="scroll-area mt-[14px] min-h-0 flex-1 pr-[6px]">
        <div className="flex items-baseline">
          <h3 className="text-base font-semibold text-ink-primary">Плоскости</h3>
          <span className="ml-[26px] w-[108px] text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
            RAAN
          </span>
          <span className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
            Фаза
          </span>
        </div>

        <ul className="mt-[8px] space-y-[6px]">
          {draft.design.planes.map((plane, index) => (
            <li key={plane.id} className="flex h-[28px] items-center">
              <span
                aria-hidden="true"
                className="size-[9px] rounded-pill"
                style={{ background: PLANE_DOT[index % PLANE_DOT.length] }}
              />
              <span
                title={plane.id}
                className="ml-[9px] w-[120px] shrink-0 truncate text-small font-semibold text-ink-primary"
              >
                {plane.id}
              </span>
              <DegreeInput
                label={`RAAN плоскости ${plane.id}`}
                value={plane.raan_deg}
                onChange={(value) => { props.onChange(withPlane(draft, plane.id, { raan_deg: value })); }}
              />
              <DegreeInput
                label={`Фаза плоскости ${plane.id}`}
                value={plane.phase_deg}
                onChange={(value) => { props.onChange(withPlane(draft, plane.id, { phase_deg: value })); }}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          aria-expanded={conditionsOpen}
          onClick={() => { setConditionsOpen((value) => !value); }}
          className="mt-[12px] flex h-[34px] w-full items-center rounded-sm border border-line-subtle bg-surface-sunken px-[11px]"
        >
          {conditionsOpen ? (
            <ChevronDown aria-hidden="true" className="size-[15px] text-ink-secondary" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-[15px] text-ink-secondary" />
          )}
          <span className="ml-[8px] text-small font-semibold text-ink-primary">Условия расчёта</span>
          <span className="ml-auto text-micro font-medium text-ink-muted" data-numeric>
            {formatTick(draft.environment.horizon_s)} · {draft.environment.step_s} с · ISL{' '}
            {draft.environment.isl_range_km} км
          </span>
        </button>

        {conditionsOpen && (
          <div className="mt-[10px] rounded-sm border border-line-subtle bg-surface-sunken p-[11px]">
            <label className="flex items-center gap-[8px] text-caption text-ink-secondary">
              <input
                type="checkbox"
                checked={conditionsEditable}
                onChange={(event) => { setConditionsEditable(event.target.checked); }}
                className="size-[14px] accent-[var(--accent-violet)]"
              />
              Разрешить изменение условий
            </label>
            {conditionsEditable && (
              <p className="mt-[6px] text-micro text-status-warning">
                Варианты с разными условиями не сравниваются напрямую
              </p>
            )}
            <dl className="mt-[10px] space-y-[6px]">
              {ENVIRONMENT_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-[10px]">
                  <dt className="text-caption text-ink-secondary">{field.label}</dt>
                  <dd className="flex items-center gap-[6px]">
                    <input
                      type="number"
                      value={draft.environment[field.key]}
                      disabled={!conditionsEditable}
                      aria-label={field.label}
                      onChange={(event) => {
                        props.onChange(
                          withEnvironment(draft, { [field.key]: Number(event.target.value) }),
                        );
                      }}
                      className="h-[26px] w-[96px] rounded-[10px] border border-line bg-surface-input px-[8px] text-caption text-ink-primary disabled:border-line-subtle disabled:text-ink-secondary"
                      data-numeric
                    />
                    <span className="w-[24px] text-micro text-ink-muted">{field.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <h3 className="mt-[14px] text-base font-semibold text-ink-primary">Политика маршрутизации</h3>
        <div className="mt-[8px] flex h-[42px] items-center gap-[2px] rounded-sm border border-line-subtle bg-surface-track p-[3px]">
          {POLICIES.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={props.policy === option.value}
              onClick={() => { props.onPolicy(option.value); }}
              className={cx(
                'h-[34px] flex-1 rounded-[9px] text-caption font-semibold transition-colors duration-150',
                props.policy === option.value ? 'bg-accent-violet text-ink-onAccent' : 'text-ink-secondary',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-[14px] flex items-center">
          <h3 className="text-base font-semibold text-ink-primary">Отказы</h3>
          <span className="ml-[10px] rounded-pill bg-surface-chip px-[8px] py-[2px] text-micro font-semibold text-ink-secondary">
            {draft.failures.length + draft.gateway_outages.length}
          </span>
          <button
            type="button"
            onClick={props.onAddFailure}
            className="ml-auto text-caption font-semibold text-accent-blue"
          >
            + Добавить
          </button>
        </div>

        {draft.failures.length + draft.gateway_outages.length === 0 ? (
          <p className="mt-[8px] rounded-sm border border-line-subtle bg-surface-sunken px-[11px] py-[9px] text-caption text-ink-secondary">
            Отказов в варианте нет. «Добавить» задаёт интервал недоступности аппарата или шлюза.
          </p>
        ) : (
          <ul className="mt-[8px] space-y-[4px]">
            {draft.failures.map((failure, index) => (
              <FailureRow
                key={`sat-${failure.satellite_id}-${failure.start_s}`}
                icon={<Rocket aria-hidden="true" className="size-[14px] text-ink-secondary" />}
                id={failure.satellite_id}
                startS={failure.start_s}
                endS={failure.end_s}
                onRemove={() => {
                  props.onChange(
                    withFailures(draft, draft.failures.filter((_, position) => position !== index)),
                  );
                }}
              />
            ))}
            {draft.gateway_outages.map((outage, index) => (
              <FailureRow
                key={`gw-${outage.gateway_id}-${outage.start_s}`}
                icon={<SatelliteDish aria-hidden="true" className="size-[14px] text-ink-secondary" />}
                id={outage.gateway_id}
                startS={outage.start_s}
                endS={outage.end_s}
                onRemove={() => {
                  props.onChange(
                    withGatewayOutages(
                      draft,
                      draft.gateway_outages.filter((_, position) => position !== index),
                    ),
                  );
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {changes.length > 0 && (
        <div className="mt-[12px] flex h-[44px] items-center rounded-sm border border-[rgba(255,160,92,0.38)] bg-[rgba(255,160,92,0.14)] px-[11px]">
          <Pencil aria-hidden="true" className="size-[14px] text-status-warning" />
          <span className="ml-[8px] text-caption font-semibold text-status-warning">
            Черновик · {changes.length}
          </span>
          <button
            type="button"
            onClick={props.onReset}
            className="ml-auto h-[30px] rounded-[9px] bg-surface-chip px-[12px] text-caption font-semibold text-ink-secondary"
          >
            Сбросить
          </button>
          <button
            type="button"
            onClick={props.onSaveVariant}
            className="ml-[8px] h-[30px] rounded-[9px] bg-accent-violet px-[12px] text-caption font-semibold text-ink-onAccent"
          >
            Сохранить вариант
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={props.onPreview}
        className="mt-[12px] flex h-[42px] items-center justify-center gap-[8px] rounded-sm border border-line bg-surface-raised text-small font-semibold text-ink-primary transition-colors duration-150 hover:border-line-strong"
      >
        <BarChart3 aria-hidden="true" className="size-[16px]" />
        Предпросмотр
      </button>

      {activeRun !== null ? (
        <div className="mt-[12px] rounded-[14px] border border-[rgba(145,132,255,0.7)] bg-[rgba(108,92,231,0.26)] px-[13px] py-[9px]">
          <div className="flex items-center">
            <span className="text-caption font-semibold text-ink-primary" data-numeric>
              {STAGE_LABEL[activeRun.stage]} · {activeRun.completed_ticks} из {activeRun.total_ticks}
            </span>
            <button
              type="button"
              onClick={props.onCancelRun}
              className="ml-auto text-caption font-semibold text-status-danger"
            >
              Отменить
            </button>
          </div>
          <div className="mt-[8px] h-[6px] overflow-hidden rounded-pill bg-[rgba(242,245,255,0.2)]">
            <div
              className="h-full rounded-pill bg-ink-primary transition-[width] duration-150"
              style={{ width: `${Math.round(activeRun.progress * 100)}%` }}
            />
          </div>
          <p className="mt-[6px] text-micro text-ink-secondary">{stageStep(activeRun.stage)}</p>
        </div>
      ) : (
        <button
          type="button"
          disabled={props.runStarting}
          onClick={props.onRun}
          className="mt-[12px] flex h-[48px] items-center justify-center rounded-sm bg-accent-violet text-base font-semibold text-ink-onAccent shadow-glow-violet transition-[filter] duration-150 hover:brightness-110 disabled:opacity-45"
        >
          {props.runStarting ? 'Ставим в очередь…' : 'Запустить расчёт'}
        </button>
      )}

      {props.runError !== null && (
        <p role="alert" className="mt-[8px] text-caption text-status-danger">
          {props.runError}
        </p>
      )}
    </div>
  );
}

const PLANE_DOT = [
  'var(--status-success)',
  'var(--accent-violet-light)',
  'var(--accent-blue)',
  'var(--map-client-selected)',
  'var(--status-warning)',
  'var(--map-backup)',
];

function DegreeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      max={359}
      step={1}
      value={value}
      aria-label={label}
      onChange={(event) => {
        const next = Number(event.target.value);
        // Диапазон [0; 360): 360 и −1 — это те же 0 и 359, а не ошибка ввода.
        onChange(((next % 360) + 360) % 360);
      }}
      className="mr-[12px] h-[28px] w-[96px] rounded-[10px] border border-line bg-surface-input px-[11px] text-small font-medium text-ink-primary"
      data-numeric
    />
  );
}

function FailureRow({
  icon,
  id,
  startS,
  endS,
  onRemove,
}: {
  icon: ReactNode;
  id: string;
  startS: number;
  endS: number;
  onRemove: () => void;
}) {
  return (
    <li className="flex h-[32px] items-center rounded-[10px] border border-line-subtle bg-surface-sunken px-[11px]">
      {icon}
      <span className="ml-[8px] w-[86px] truncate text-caption font-semibold text-ink-primary">{id}</span>
      <span className="text-caption text-ink-secondary" data-numeric>
        {formatTick(startS)} – {formatTick(endS)}
      </span>
      <button
        type="button"
        aria-label={`Удалить отказ ${id}`}
        onClick={onRemove}
        className="ml-auto text-ink-muted transition-colors duration-150 hover:text-status-danger"
      >
        <Trash2 aria-hidden="true" className="size-[14px]" />
      </button>
    </li>
  );
}
