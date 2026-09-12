import { AlertTriangle, Play } from 'lucide-react';

import type { Experiment, RoutingPolicy, Variant } from '@/api/types';
import { Card } from '@/components/ui/Card';
import { policyTitle, ROUTING_POLICIES } from '@/features/compare/policies';
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
        options={ROUTING_POLICIES.map((item) => ({ value: item, title: policyTitle(item) }))}
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
        <p
          role="alert"
          className="absolute left-[23px] top-[577px] flex w-[376px] items-start gap-[6px] text-[11px] text-status-warning"
        >
          <AlertTriangle aria-hidden="true" className="mt-[1px] size-[12px] shrink-0" />
          {budgetProblem}
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
    <>
      <span
        className="absolute left-[23px] text-[16px] font-semibold text-ink-primary"
        style={{ top }}
      >
        {title}
      </span>
      <SelectField
        label={`${title}: параметр`}
        left={23}
        top={top + 26}
        width={FIELD_WIDTH}
        value={draft.path}
        onChange={(value) => { onChange(withDefaults(value, options)); }}
        options={list}
      />

      <FieldLabel left={23} top={top + 78}>
        ОТ
      </FieldLabel>
      <FieldLabel left={157} top={top + 78}>
        ДО
      </FieldLabel>
      <FieldLabel left={291} top={top + 78}>
        ШАГ
      </FieldLabel>

      <NumberField
        label={`${title}: от`}
        left={23}
        top={top + 94}
        width={124}
        disabled={disabled}
        invalid={check.problems.length > 0}
        value={draft.from}
        onChange={(from) => { onChange({ ...draft, from }); }}
      />
      <NumberField
        label={`${title}: до`}
        left={157}
        top={top + 94}
        width={124}
        disabled={disabled}
        invalid={check.problems.length > 0}
        value={draft.to}
        onChange={(to) => { onChange({ ...draft, to }); }}
      />
      <NumberField
        label={`${title}: шаг`}
        left={291}
        top={top + 94}
        width={108}
        disabled={disabled}
        invalid={check.problems.length > 0}
        value={draft.step}
        onChange={(step) => { onChange({ ...draft, step }); }}
      />

      {check.problems.length > 0 && (
        <p
          role="alert"
          className="absolute left-[23px] w-[376px] text-[11px] text-status-danger"
          style={{ top: top + 140 }}
        >
          {check.problems.join('; ')}
        </p>
      )}
    </>
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
