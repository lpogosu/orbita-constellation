import { AlertTriangle, Play } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Experiment, RoutingPolicy, Variant } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { Card } from '@/components/ui/Card';
import { policyLabel, ROUTING_POLICIES } from '@/lib/run-format';
import { cx } from '@/lib/cx';
import { formatShareShort } from '@/lib/measures';
import { bottomAnchoredTop, centerAnchoredTop } from '@/styles/readable-text';
import { draftFor, NO_AXIS } from './axes';
import type { AxisCheck, AxisDraft, AxisOption } from './axes';
import { FieldLabel, NumberField, SelectField, StaticField } from './fields';

const LEFT = 25;
const TOP = 200;
const FIELD_WIDTH = 376;

export interface BudgetDraft {
  readonly maxPoints: string;
  readonly maxSeconds: string;
}

interface SetupCardProps {
  readonly baseVariant: Variant;
  readonly options: readonly AxisOption[];
  readonly axisX: AxisDraft;
  readonly axisY: AxisDraft;
  readonly checkX: AxisCheck;
  readonly checkY: AxisCheck;
  readonly policy: RoutingPolicy;
  readonly budget: BudgetDraft;
  readonly budgetProblem: string | null;
  readonly running: Experiment | null;
  readonly starting: boolean;
  /** Место карточки в сетке потока; на полотне не используется. */
  readonly stackedClassName?: string;
  readonly onAxisX: (draft: AxisDraft) => void;
  readonly onAxisY: (draft: AxisDraft) => void;
  readonly onPolicy: (policy: RoutingPolicy) => void;
  readonly onBudget: (budget: BudgetDraft) => void;
  readonly onStart: () => void;
}

/**
 * «Постановка эксперимента» (узел Figma `142:1136`). Поля проверяются на клиенте — шаг
 * больше нуля, начало меньше конца, число точек не выше бюджета, — но это проверка формы,
 * а не расчёт: сами точки считает сервис.
 *
 * На полотне поля стоят по координатам макета, в потоке те же поля идут колонкой: каждое
 * получает координаты только на полотне, без них поле встаёт в поток само.
 */
export function SetupCard({
  baseVariant,
  options,
  axisX,
  axisY,
  checkX,
  checkY,
  policy,
  budget,
  budgetProblem,
  running,
  starting,
  stackedClassName,
  onAxisX,
  onAxisY,
  onPolicy,
  onBudget,
  onStart,
}: SetupCardProps) {
  const stacked = useStacked();
  const gridPoints = checkX.points * checkY.points;
  const blocked =
    checkX.axis === null ||
    checkY.problems.length > 0 ||
    budgetProblem !== null;

  // В потоке координаты не передаются вовсе: поле без них не получает `absolute`.
  const at = (left: number, top: number, width?: number) =>
    stacked ? {} : { left, top, ...(width === undefined ? {} : { width }) };

  const budgetFields = (
    <>
      <NumberField
        label="Точек, не более"
        {...at(23, 527, 182)}
        {...(stacked ? { className: 'min-w-0' } : {})}
        value={budget.maxPoints}
        invalid={budgetProblem !== null}
        onChange={(value) => { onBudget({ ...budget, maxPoints: value }); }}
      />
      <NumberField
        label="Секунд, не более"
        {...at(217, 527, 182)}
        {...(stacked ? { className: 'min-w-0' } : {})}
        value={budget.maxSeconds}
        onChange={(value) => { onBudget({ ...budget, maxSeconds: value }); }}
      />
    </>
  );

  const gridHint =
    budgetProblem === null ? (
      <p
        className={cx('text-[11px] text-ink-muted', !stacked && 'absolute left-[23px]')}
        // Строка зажата между полями бюджета и кнопкой: подросший кегль делится поровну.
        style={stacked ? undefined : { top: centerAnchoredTop(577, 16.5) }}
        data-numeric
      >
        сетка {checkX.points} × {checkY.points} = {gridPoints}{' '}
        {gridPoints === 1 ? 'точка' : 'точек'}
      </p>
    ) : stacked ? (
      // В потоке место под объяснение не ограничено: текст переносится целиком.
      <p role="alert" className="flex gap-[6px] text-[11px] text-status-warning">
        <AlertTriangle aria-hidden="true" className="mt-px size-[12px] shrink-0" />
        <span className="min-w-0">{budgetProblem}</span>
      </p>
    ) : (
      // Между полями бюджета и кнопкой запуска ровно одна строка: вторая легла бы на
      // кнопку, поэтому длинное объяснение уходит в подсказку.
      <p
        role="alert"
        title={budgetProblem}
        className="absolute left-[23px] top-[577px] flex h-[16px] w-[376px] items-center gap-[6px] text-[11px] text-status-warning"
      >
        <AlertTriangle aria-hidden="true" className="size-[12px] shrink-0" />
        <span className="min-w-0 truncate">{budgetProblem}</span>
      </p>
    );

  const action =
    running === null ? (
      <button
        type="button"
        disabled={blocked || starting}
        onClick={onStart}
        className={cx(
          'flex h-[50px] items-center justify-center gap-[10px]',
          stacked ? 'w-full' : 'absolute left-[23px] top-[598px] w-[376px]',
          'rounded-[13px] bg-accent-violet text-[17px] font-semibold text-ink-onAccent shadow-glow-violet',
          'transition-[filter] duration-150 hover:brightness-110',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100',
        )}
      >
        <Play aria-hidden="true" className="size-[18px]" />
        {starting ? 'Запускаем…' : 'Запустить эксперимент'}
      </button>
    ) : (
      <Progress experiment={running} />
    );

  const policyField = (
    <SelectField
      label="Политика маршрутизации"
      {...at(23, 395, FIELD_WIDTH)}
      value={policy}
      onChange={(value) => { onPolicy(value as RoutingPolicy); }}
      options={ROUTING_POLICIES.map((item) => ({ value: item, title: policyLabel(item) }))}
    />
  );

  const targetField = (
    <StaticField
      label="Целевая метрика"
      {...at(23, 461, FIELD_WIDTH)}
      value={`min доступность клиента ≥ ${formatShareShort(baseVariant.scenario.environment.target_availability)}`}
    />
  );

  const axes = (
    <>
      <AxisFields
        title="Ось X"
        top={63}
        draft={axisX}
        check={checkX}
        options={options}
        allowEmpty={false}
        onChange={onAxisX}
      />
      <AxisFields
        title="Ось Y"
        top={221}
        draft={axisY}
        check={checkY}
        options={options}
        allowEmpty
        onChange={onAxisY}
      />
    </>
  );

  if (stacked) {
    return (
      <Card className={cx('flex flex-col gap-[20px] p-[20px]', stackedClassName)}>
        <div className="flex flex-col gap-[4px] border-b border-line-divider pb-[12px]">
          <FieldLabel>БАЗОВЫЙ ВАРИАНТ</FieldLabel>
          <p className="truncate text-[13px] font-semibold text-ink-primary" title={baseVariant.title}>
            {baseVariant.title}
          </p>
        </div>
        {axes}
        <Group label="ПОЛИТИКА МАРШРУТИЗАЦИИ">{policyField}</Group>
        <Group label="ЦЕЛЬ ИЗ СЦЕНАРИЯ">{targetField}</Group>
        <Group label="БЮДЖЕТ">
          <div className="grid grid-cols-2 gap-[12px]">{budgetFields}</div>
          {gridHint}
        </Group>
        {action}
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[656px] w-[424px]"
      style={{ left: LEFT, top: TOP }}
    >
      {/* Базовый вариант не выбирается: перебор всегда идёт от активного варианта проекта
          (`14_SCREENS.md` §5.1), а меняют активный на «Сети». */}
      <FieldLabel left={23} top={12}>
        БАЗОВЫЙ ВАРИАНТ
      </FieldLabel>
      {/* Название прижато низом к разделителю под ним, подпись над ним — к названию. */}
      <p
        className="absolute left-[23px] w-[376px] truncate text-[13px] font-semibold text-ink-primary"
        style={{ top: bottomAnchoredTop(27, 19.5) }}
        title={baseVariant.title}
      >
        {baseVariant.title}
      </p>
      <div className="absolute left-[23px] top-[47px] h-px w-[376px] bg-line-divider" />

      {axes}

      <FieldLabel left={23} top={379}>
        ПОЛИТИКА МАРШРУТИЗАЦИИ
      </FieldLabel>
      {policyField}

      <FieldLabel left={23} top={445}>
        ЦЕЛЬ ИЗ СЦЕНАРИЯ
      </FieldLabel>
      {targetField}

      <FieldLabel left={23} top={511}>
        БЮДЖЕТ
      </FieldLabel>
      {budgetFields}
      {gridHint}
      {action}
    </Card>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function AxisFields({
  title,
  top,
  draft,
  check,
  options,
  allowEmpty,
  onChange,
}: {
  title: string;
  top: number;
  draft: AxisDraft;
  check: AxisCheck;
  options: readonly AxisOption[];
  allowEmpty: boolean;
  onChange: (draft: AxisDraft) => void;
}) {
  const stacked = useStacked();
  const disabled = draft.path === NO_AXIS;
  const list = allowEmpty
    ? [{ value: NO_AXIS, title: 'нет — перебор по одной оси' }, ...asItems(options)]
    : asItems(options);

  return (
    <section
      className={stacked ? 'w-full' : 'absolute left-[23px] w-[376px]'}
      style={stacked ? undefined : { top }}
    >
      <h2 className="h-[20px] text-[16px] font-semibold leading-[20px] text-ink-primary">
        {title}
      </h2>
      <SelectField
        label={`${title}: параметр`}
        className="mt-[6px] w-full"
        value={draft.path}
        onChange={(value) => { onChange(withDefaults(value, options)); }}
        options={list}
      />

      <div
        className={cx(
          'mt-[10px] grid grid-rows-[12px_42px] gap-x-[10px] gap-y-[4px]',
          stacked ? 'grid-cols-3' : 'grid-cols-[124px_124px_minmax(0,1fr)]',
        )}
      >
        <FieldLabel className="block leading-[12px]">ОТ</FieldLabel>
        <FieldLabel className="block leading-[12px]">ДО</FieldLabel>
        <FieldLabel className="block leading-[12px]">ШАГ</FieldLabel>

        <NumberField
          label={`${title}: от`}
          className="w-full min-w-0"
          disabled={disabled}
          invalid={check.problems.length > 0}
          value={draft.from}
          onChange={(from) => { onChange({ ...draft, from }); }}
        />
        <NumberField
          label={`${title}: до`}
          className="w-full min-w-0"
          disabled={disabled}
          invalid={check.problems.length > 0}
          value={draft.to}
          onChange={(to) => { onChange({ ...draft, to }); }}
        />
        <NumberField
          label={`${title}: шаг`}
          className="w-full min-w-0"
          disabled={disabled}
          invalid={check.problems.length > 0}
          value={draft.step}
          onChange={(step) => { onChange({ ...draft, step }); }}
        />
      </div>

      {check.problems.length > 0 && (
        <p
          role="alert"
          title={check.problems.join('; ')}
          className={cx(
            'mt-[4px] w-full text-[11px] text-status-danger',
            !stacked && 'h-[16px] truncate',
          )}
        >
          {check.problems.join('; ')}
        </p>
      )}
    </section>
  );
}

function Progress({ experiment }: { experiment: Experiment }) {
  const stacked = useStacked();
  const share = Math.round(experiment.progress * 100);

  if (stacked) {
    return (
      <div className="flex flex-col gap-[8px] rounded-[13px] border border-accent-violet-light bg-surface-row-active px-[13px] py-[10px]">
        <p className="flex items-baseline justify-between gap-[12px]">
          <span className="text-[13px] font-semibold text-ink-primary">
            Прогон {experiment.completed_points} из {experiment.total_points}
          </span>
          <span className="text-caption font-semibold text-ink-secondary" data-numeric>
            {share} %
          </span>
        </p>
        <ProgressBar share={share} />
        <p className="text-[11px] text-ink-secondary">результаты появляются по мере готовности</p>
      </div>
    );
  }

  return (
    <div className="absolute left-[23px] top-[592px] h-[62px] w-[376px] overflow-hidden rounded-[13px] border border-accent-violet-light bg-surface-row-active">
      <p className="absolute left-[13px] top-[9px] text-[13px] font-semibold text-ink-primary">
        Прогон {experiment.completed_points} из {experiment.total_points}
      </p>
      <p
        className="absolute right-[13px] top-[10px] text-caption font-semibold text-ink-secondary"
        data-numeric
      >
        {share} %
      </p>
      <div className="absolute left-[13px] top-[33px] w-[348px]">
        <ProgressBar share={share} />
      </div>
      <p className="absolute left-[13px] top-[43px] text-[11px] text-ink-secondary">
        результаты появляются по мере готовности
      </p>
    </div>
  );
}

function ProgressBar({ share }: { share: number }) {
  return (
    <div
      className="h-[6px] w-full overflow-hidden rounded-pill bg-surface-chip"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={share}
      aria-label="Прогресс эксперимента"
    >
      <div
        className="h-full rounded-pill bg-ink-primary transition-[width] duration-200"
        style={{ width: `${share}%` }}
      />
    </div>
  );
}

function withDefaults(path: string, options: readonly AxisOption[]): AxisDraft {
  const option = options.find((item) => item.path === path);
  return option === undefined ? { path, from: '', to: '', step: '' } : draftFor(option);
}

function asItems(options: readonly AxisOption[]): { value: string; title: string }[] {
  return options.map((option) => ({ value: option.path, title: option.title }));
}
