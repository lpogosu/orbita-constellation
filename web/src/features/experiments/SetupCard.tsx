import { AlertTriangle, Play } from 'lucide-react';

import type { Experiment, RoutingPolicy, Variant } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { policyLabel, ROUTING_POLICIES } from '@/lib/run-format';
import { cx } from '@/lib/cx';
import { formatShareShort } from '@/lib/measures';
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
  onAxisX,
  onAxisY,
  onPolicy,
  onBudget,
  onStart,
}: SetupCardProps) {
  const gridPoints = checkX.points * checkY.points;
  const blocked =
    checkX.axis === null ||
    checkY.problems.length > 0 ||
    budgetProblem !== null;

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
      <p className="absolute left-[23px] top-[27px] w-[376px] truncate text-[13px] font-semibold text-ink-primary">
        {baseVariant.title}
      </p>
      <div className="absolute left-[23px] top-[47px] h-px w-[376px] bg-line-divider" />

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

      <FieldLabel left={23} top={379}>
        ПОЛИТИКА МАРШРУТИЗАЦИИ
      </FieldLabel>
      <SelectField
        label="Политика маршрутизации"
        left={23}
        top={395}
        width={FIELD_WIDTH}
        value={policy}
        onChange={(value) => { onPolicy(value as RoutingPolicy); }}
        options={ROUTING_POLICIES.map((item) => ({ value: item, title: policyLabel(item) }))}
      />

      <FieldLabel left={23} top={445}>
        ЦЕЛЬ ИЗ СЦЕНАРИЯ
      </FieldLabel>
      <StaticField
        label="Целевая метрика"
        left={23}
        top={461}
        width={FIELD_WIDTH}
        value={`min доступность клиента ≥ ${formatShareShort(baseVariant.scenario.environment.target_availability)}`}
      />

      <FieldLabel left={23} top={511}>
        БЮДЖЕТ
      </FieldLabel>
      <NumberField
        label="Точек, не более"
        left={23}
        top={527}
        width={182}
        value={budget.maxPoints}
        invalid={budgetProblem !== null}
        onChange={(value) => { onBudget({ ...budget, maxPoints: value }); }}
      />
      <NumberField
        label="Секунд, не более"
        left={217}
        top={527}
        width={182}
        value={budget.maxSeconds}
        onChange={(value) => { onBudget({ ...budget, maxSeconds: value }); }}
      />

      {budgetProblem === null ? (
        <p className="absolute left-[23px] top-[577px] text-[11px] text-ink-muted" data-numeric>
          сетка {checkX.points} × {checkY.points} = {gridPoints}{' '}
          {gridPoints === 1 ? 'точка' : 'точек'}
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
      )}

      {running === null ? (
        <button
          type="button"
          disabled={blocked || starting}
          onClick={onStart}
          className={cx(
            'absolute left-[23px] top-[598px] flex h-[50px] w-[376px] items-center justify-center gap-[10px]',
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
      )}
    </Card>
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
  const disabled = draft.path === NO_AXIS;
  const list = allowEmpty
    ? [{ value: NO_AXIS, title: 'нет — перебор по одной оси' }, ...asItems(options)]
    : asItems(options);

  return (
    <section className="absolute left-[23px] w-[376px]" style={{ top }}>
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

      <div className="mt-[10px] grid grid-cols-[124px_124px_minmax(0,1fr)] grid-rows-[12px_42px] gap-x-[10px] gap-y-[4px]">
      <FieldLabel className="block leading-[12px]">
        ОТ
      </FieldLabel>
      <FieldLabel className="block leading-[12px]">
        ДО
      </FieldLabel>
      <FieldLabel className="block leading-[12px]">
        ШАГ
      </FieldLabel>

      <NumberField
        label={`${title}: от`}
        className="w-full"
        disabled={disabled}
        invalid={check.problems.length > 0}
        value={draft.from}
        onChange={(from) => { onChange({ ...draft, from }); }}
      />
      <NumberField
        label={`${title}: до`}
        className="w-full"
        disabled={disabled}
        invalid={check.problems.length > 0}
        value={draft.to}
        onChange={(to) => { onChange({ ...draft, to }); }}
      />
      <NumberField
        label={`${title}: шаг`}
        className="w-full"
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
          className="mt-[4px] h-[16px] w-full truncate text-[11px] text-status-danger"
        >
          {check.problems.join('; ')}
        </p>
      )}
    </section>
  );
}

function Progress({ experiment }: { experiment: Experiment }) {
  const share = Math.round(experiment.progress * 100);

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
      <div className="absolute left-[13px] top-[33px] h-[6px] w-[348px] overflow-hidden rounded-pill bg-surface-chip">
        <div
          className="h-full rounded-pill bg-ink-primary transition-[width] duration-200"
          style={{ width: `${share}%` }}
        />
      </div>
      <p className="absolute left-[13px] top-[43px] text-[11px] text-ink-secondary">
        результаты появляются по мере готовности
      </p>
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
