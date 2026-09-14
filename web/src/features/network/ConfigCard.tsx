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
import { useCardBox } from '@/components/layout/box';
import { useCanvasTextSize } from '@/app/use-viewport';
import { useStacked } from '@/app/viewport-mode';

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
  const { horizon_s: horizon, step_s: step, isl_range_km: islRange } = draft.environment;
  const conditionsSummary = `${formatTick(horizon)} · ${step} с · ISL ${islRange} км`;
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [conditionsEditable, setConditionsEditable] = useState(false);

  const stages = [1, 2, 3];
  const activeRun =
    props.run !== null && (props.run.status === 'queued' || props.run.status === 'running')
      ? props.run
      : null;

  const box = useCardBox(props);
  // В потоке панель — обычная карточка колонки: высота по содержимому, органы управления
  // не ниже 40 пикселей, строки плоскостей — сеткой, которая сжимается вместе с шириной.
  const stacked = useStacked();
  const textSize = useCanvasTextSize();
  // Сводка условий усекается только при подросшем кегле: пока текст макетный, лишняя
  // обрезка меняла растеризацию прокручиваемой панели на 1920×1080.
  const summaryGrown = !stacked && textSize(11) > 11;
  // Плашка черновика в 44 пикселя вмещает подпись и две кнопки только макетным кеглем.
  // Подросший текст переносил кнопки по словам внутри них; вместо этого плашка, как в
  // потоке, отпускает кнопки второй строкой за счёт прокручиваемой середины панели.
  const draftGrown = !stacked && textSize(12) > 12;

  return (
    <div
      className={cx(
        'card-glass flex flex-col',
        box.positionClass,
        stacked ? 'p-[16px]' : 'px-[25px] pb-[18px] pt-[13px]',
      )}
      style={box.style}
    >
      <Select
        label="Вариант"
        value={props.variantId ?? ''}
        options={props.variants.map((variant) => ({ value: variant.id, title: variant.title }))}
        onChange={props.onSelectVariant}
        placeholder="Вариант не выбран"
        triggerClassName={cx(
          'w-full rounded-lg border border-line bg-surface-input pr-[16px] font-semibold leading-none text-ink-primary hover:border-line-strong',
          stacked ? 'h-[48px] pl-[16px] text-base' : 'h-[52px] pl-[22px] text-[20px]',
        )}
      />

      <p className="mt-[10px] text-base font-semibold text-ink-primary">Этап запуска</p>
      <div
        className={cx(
          'mt-[8px] flex items-center gap-[2px] rounded-[14px] border border-line-subtle bg-surface-input p-[3px]',
          stacked ? 'h-[48px]' : 'h-[44px]',
        )}
      >
        {stages.map((stage) => (
          <button
            key={stage}
            type="button"
            aria-pressed={draft.design.launch_stage === stage}
            onClick={() => { props.onChange(withLaunchStage(draft, stage)); }}
            className={cx(
              'flex-1 rounded-[9px] text-title-m font-semibold transition-colors duration-150',
              stacked ? 'h-[40px]' : 'h-[36px]',
              draft.design.launch_stage === stage
                ? 'bg-accent-violet text-ink-onAccent shadow-glow-violet'
                : 'text-ink-secondary',
            )}
          >
            {stage}
          </button>
        ))}
      </div>

      <div className={stacked ? 'mt-[16px]' : 'scroll-area mt-[14px] min-h-0 flex-1 pr-[6px]'}>
        <div className={stacked ? cx(PLANE_GRID, 'items-baseline') : 'flex items-baseline'}>
          <h3 className="text-base font-semibold text-ink-primary">Плоскости</h3>
          <span
            className={cx(
              'text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted',
              !stacked && 'ml-[26px] w-[108px]',
            )}
          >
            RAAN
          </span>
          <span className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted">
            Фаза
          </span>
        </div>

        <ul className="mt-[8px] space-y-[6px]">
          {draft.design.planes.map((plane, index) => (
            <li key={plane.id} className={stacked ? cx(PLANE_GRID, 'items-center') : 'flex h-[28px] items-center'}>
              <span className="flex min-w-0 items-center">
                <span
                  aria-hidden="true"
                  className="size-[9px] shrink-0 rounded-pill"
                  style={{ background: PLANE_DOT[index % PLANE_DOT.length] }}
                />
                <span
                  title={plane.id}
                  className={cx(
                    'ml-[9px] shrink-0 truncate text-small font-semibold text-ink-primary',
                    stacked ? 'min-w-0 flex-1' : 'w-[120px]',
                  )}
                >
                  {plane.id}
                </span>
              </span>
              <DegreeInput
                label={`RAAN плоскости ${plane.id}`}
                value={plane.raan_deg}
                stacked={stacked}
                onChange={(value) => { props.onChange(withPlane(draft, plane.id, { raan_deg: value })); }}
              />
              <DegreeInput
                label={`Фаза плоскости ${plane.id}`}
                value={plane.phase_deg}
                stacked={stacked}
                onChange={(value) => { props.onChange(withPlane(draft, plane.id, { phase_deg: value })); }}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          aria-expanded={conditionsOpen}
          onClick={() => { setConditionsOpen((value) => !value); }}
          className={cx(
            'mt-[12px] flex w-full items-center rounded-sm border border-line-subtle bg-surface-sunken px-[11px] text-left',
            stacked ? 'min-h-[44px] flex-wrap gap-x-[8px] py-[6px]' : 'h-[34px]',
          )}
        >
          {conditionsOpen ? (
            <ChevronDown aria-hidden="true" className="size-[15px] text-ink-secondary" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-[15px] text-ink-secondary" />
          )}
          <span className="ml-[8px] whitespace-nowrap text-small font-semibold text-ink-primary">
            {summaryGrown ? 'Условия' : 'Условия расчёта'}
          </span>
          {/* На полотне сводка делит строку шириной 260 пикселей с подписью: подросший на
              ноутбуке кегль сводил их вплотную, а на 1280×720 выталкивал «км» за край кнопки.
              Цифры сводки не обрезаются — место уступает подпись, она становится короче. */}
          <span
            className={cx(
              'ml-auto whitespace-nowrap text-micro font-medium text-ink-muted',
              summaryGrown && 'pl-[8px]',
            )}
            title={conditionsSummary}
            data-numeric
          >
            {formatTick(horizon)} · {step} с · ISL{' '}
            {islRange} км
          </span>
        </button>

        {conditionsOpen && (
          <div className="mt-[10px] rounded-sm border border-line-subtle bg-surface-sunken p-[11px]">
            <label
              className={cx(
                'flex items-center gap-[8px] text-caption text-ink-secondary',
                stacked && 'min-h-[40px]',
              )}
            >
              <input
                type="checkbox"
                checked={conditionsEditable}
                onChange={(event) => { setConditionsEditable(event.target.checked); }}
                className={cx('accent-[var(--accent-violet)]', stacked ? 'size-[20px]' : 'size-[14px]')}
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
                      className={cx(
                        'w-[96px] rounded-[10px] border border-line bg-surface-input px-[8px] text-caption text-ink-primary disabled:border-line-subtle disabled:text-ink-secondary',
                        stacked ? 'h-[40px]' : 'h-[26px]',
                      )}
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
        <div
          className={cx(
            'mt-[8px] flex items-center gap-[2px] rounded-sm border border-line-subtle bg-surface-track p-[3px]',
            stacked ? 'h-[48px]' : 'h-[42px]',
          )}
        >
          {POLICIES.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={props.policy === option.value}
              onClick={() => { props.onPolicy(option.value); }}
              className={cx(
                'flex-1 rounded-[9px] text-caption font-semibold transition-colors duration-150',
                stacked ? 'h-[40px]' : 'h-[34px]',
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
            className={cx(
              'ml-auto text-caption font-semibold text-accent-blue',
              stacked && 'h-[40px] px-[8px]',
            )}
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
                stacked={stacked}
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
                stacked={stacked}
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
        <div
          className={cx(
            'mt-[12px] flex items-center rounded-sm border border-[rgba(255,160,92,0.38)] bg-[rgba(255,160,92,0.14)] px-[11px]',
            stacked && 'flex-wrap gap-y-[8px] py-[8px]',
            draftGrown && 'flex-wrap gap-y-[6px] whitespace-nowrap py-[6px]',
            !stacked && !draftGrown && 'h-[44px]',
          )}
        >
          <Pencil aria-hidden="true" className="size-[14px] text-status-warning" />
          <span className="ml-[8px] text-caption font-semibold text-status-warning">
            Черновик · {changes.length}
          </span>
          <button
            type="button"
            onClick={props.onReset}
            className={cx(
              'ml-auto rounded-[9px] bg-surface-chip px-[12px] text-caption font-semibold text-ink-secondary',
              stacked ? 'h-[40px]' : 'h-[30px]',
            )}
          >
            Сбросить
          </button>
          <button
            type="button"
            onClick={props.onSaveVariant}
            className={cx(
              'rounded-[9px] bg-accent-violet px-[12px] text-caption font-semibold text-ink-onAccent',
              draftGrown ? 'ml-auto' : 'ml-[8px]',
              stacked ? 'h-[40px]' : 'h-[30px]',
            )}
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
              className={cx(
                'ml-auto text-caption font-semibold text-status-danger',
                stacked && 'h-[40px] px-[8px]',
              )}
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

/** Строка плоскости в потоке: имя забирает остаток, поля RAAN и фазы — равные колонки. */
const PLANE_GRID = 'grid grid-cols-[minmax(0,1fr)_minmax(0,96px)_minmax(0,96px)] gap-x-[10px]';

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
  stacked,
  onChange,
}: {
  label: string;
  value: number;
  stacked: boolean;
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
      className={cx(
        'rounded-[10px] border border-line bg-surface-input px-[11px] text-small font-medium text-ink-primary',
        stacked ? 'h-[40px] w-full min-w-0' : 'mr-[12px] h-[28px] w-[96px]',
      )}
      data-numeric
    />
  );
}

function FailureRow({
  icon,
  id,
  startS,
  endS,
  stacked,
  onRemove,
}: {
  stacked: boolean;
  icon: ReactNode;
  id: string;
  startS: number;
  endS: number;
  onRemove: () => void;
}) {
  return (
    <li
      className={cx(
        'flex items-center rounded-[10px] border border-line-subtle bg-surface-sunken',
        stacked ? 'h-[44px] pl-[11px] pr-[2px]' : 'h-[32px] px-[11px]',
      )}
    >
      {icon}
      <span className="ml-[8px] w-[86px] truncate text-caption font-semibold text-ink-primary">{id}</span>
      <span className="text-caption text-ink-secondary" data-numeric>
        {formatTick(startS)} – {formatTick(endS)}
      </span>
      <button
        type="button"
        aria-label={`Удалить отказ ${id}`}
        onClick={onRemove}
        className={cx(
          'ml-auto flex items-center justify-center text-ink-muted transition-colors duration-150 hover:text-status-danger',
          stacked && 'size-[40px]',
        )}
      >
        <Trash2 aria-hidden="true" className="size-[14px]" />
      </button>
    </li>
  );
}
