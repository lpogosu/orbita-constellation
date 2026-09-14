import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  createExperiment,
  isNotImplemented,
  materializePoint,
} from '@/api/experiments';
import { getProject } from '@/api/projects';
import type {
  ExperimentAxis,
  ExperimentPoint,
  ProjectDetail,
  RoutingPolicy,
  Variant,
} from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { COMPARISON_PATH, NETWORK_PATH, sectionHref } from '@/app/sections';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { groupRuns, pickRun } from '@/features/compare/runs';
import { describe, useResource } from '@/lib/use-resource';
import { axisOptions, checkAxis, draftFor, NO_AXIS, parsePositiveInteger } from './axes';
import type { AxisDraft } from './axes';
import { HeatmapCard } from './HeatmapCard';
import { PointCard } from './PointCard';
import type { PointMetric } from './points';
import { RunsCard } from './RunsCard';
import { SetupCard } from './SetupCard';
import type { BudgetDraft } from './SetupCard';
import { TradeoffCard } from './TradeoffCard';
import { useExperiment } from './use-experiment';
import { Block, PageRoot } from '@/components/layout/Slot';
import { cx } from '@/lib/cx';

const EMPTY_AXIS: AxisDraft = { path: NO_AXIS, from: '', to: '', step: '' };
const DEFAULT_BUDGET: BudgetDraft = { maxPoints: '100', maxSeconds: '600' };

/**
 * Места карточек в сетке потока. На планшете постановка и выбранная точка стоят рядом, а
 * графики и таблица — на всю ширину; на телефоне порядок DOM сохраняет смысл экрана:
 * постановка, карта, компромиссы, точка, прогоны.
 */
const PLACE = {
  setup: 'md:order-1',
  point: 'md:order-2',
  heatmap: 'md:order-3 md:col-span-2',
  tradeoff: 'md:order-4 md:col-span-2',
  runs: 'md:order-5 md:col-span-2',
} as const;

/** Параметр адреса с идентификатором эксперимента: перезагрузка не теряет результат. */
const EXPERIMENT_PARAM = 'experiment';

/**
 * Экран «07 · Исследования» (узел Figma `142:1075`). Координаты блоков — макетные:
 * постановка 424×656 на (25, 200), тепловая карта 918×420 на (465, 200), график
 * компромиссов 918×220 на (465, 636), выбранная точка 491×656 на (1403, 200) и прогоны
 * 1858×184 на (25, 872).
 *
 * Если endpoint перебора отвечает 501, форма постановки остаётся рабочей, а блоки
 * результата честно говорят, что расчёт ещё не подключён. Подставлять вместо него
 * придуманные точки нельзя — по ним будут принимать инженерное решение.
 */
export function ExperimentsPage() {
  const navigate = useNavigate();
  // Проект всегда в пути: «/experiments» без него маршрут не пропускает.
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { select } = useProjectSelection();
  const [searchParams, setSearchParams] = useSearchParams();
  const stacked = useStacked();

  const loadProject = useCallback(() => getProject(projectId), [projectId]);
  const project = useResource<ProjectDetail>(loadProject);

  const [axisX, setAxisX] = useState<AxisDraft>(EMPTY_AXIS);
  const [axisY, setAxisY] = useState<AxisDraft>(EMPTY_AXIS);
  const [policy, setPolicy] = useState<RoutingPolicy>('bfs_shortest');
  const [budget, setBudget] = useState<BudgetDraft>(DEFAULT_BUDGET);
  const [metric, setMetric] = useState<PointMetric>('min_client_availability');

  const experimentId = searchParams.get(EXPERIMENT_PARAM);
  const [startError, setStartError] = useState<string | null>(null);
  const [startNotImplemented, setStartNotImplemented] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [materializing, setMaterializing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const state = useExperiment(experimentId);

  // Открытый по адресу эксперимент показывает свою постановку: без этого форма осталась
  // бы с осями по умолчанию, и было бы непонятно, что именно перебирали.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    const experiment = state.experiment;
    if (experiment === null || restoredFor.current === experiment.id) {
      return;
    }
    restoredFor.current = experiment.id;
    const [x, y] = experiment.axes;
    if (x !== undefined) {
      setAxisX(draftOfAxis(x));
    }
    setAxisY(y === undefined ? EMPTY_AXIS : draftOfAxis(y));
    setPolicy(experiment.routing_policy);
    setBudget({
      maxPoints: String(experiment.budget.max_points),
      maxSeconds: String(experiment.budget.max_seconds),
    });
  }, [state.experiment]);

  // Открытый эксперимент перебирал конкретный вариант, и постановка на экране обязана
  // относиться к нему. Активный вариант проекта — только выбор по умолчанию для нового
  // перебора: после создания варианта с отказом он меняется, и форма подписала бы чужой.
  const experimentBaseId = state.experiment?.base_variant_id ?? null;
  const baseVariant = useMemo<Variant | null>(() => {
    if (project.data === null) {
      return null;
    }
    const wanted = experimentBaseId ?? project.data.project.active_variant_id;
    const chosen = project.data.variants.find((variant) => variant.id === wanted);
    return chosen ?? project.data.variants[0] ?? null;
  }, [project.data, experimentBaseId]);

  const options = useMemo(
    () => (baseVariant === null ? [] : axisOptions(baseVariant.scenario)),
    [baseVariant],
  );

  // Шапка показывает «Проект › Вариант» из общего выбора, а не из своих запросов.
  useEffect(() => {
    select({
      projectId: projectId === '' ? null : projectId,
      variantId: baseVariant?.id ?? null,
      runId: null,
    });
  }, [select, projectId, baseVariant]);

  // Ось X обязательна, и пустой список в поле выбора показывал бы первый параметр,
  // которого нет в состоянии формы: кнопка запуска молча оставалась бы недоступной.
  useEffect(() => {
    const first = options[0];
    if (first === undefined) {
      return;
    }
    setAxisX((current) =>
      options.some((option) => option.path === current.path) ? current : draftFor(first),
    );
    setAxisY((current) =>
      current.path === NO_AXIS || options.some((option) => option.path === current.path)
        ? current
        : EMPTY_AXIS,
    );
  }, [options]);

  const axisTitle = useCallback(
    (path: string) => options.find((option) => option.path === path)?.title ?? path,
    [options],
  );

  const checkX = checkAxis(axisX, options.find((option) => option.path === axisX.path));
  const checkY = checkAxis(axisY, options.find((option) => option.path === axisY.path));

  const maxPoints = parsePositiveInteger(budget.maxPoints);
  const maxSeconds = parsePositiveInteger(budget.maxSeconds);
  const gridPoints = checkX.points * checkY.points;
  const budgetProblem = budgetMessage(maxPoints, maxSeconds, gridPoints);

  const start = useCallback(() => {
    if (baseVariant === null || checkX.axis === null || maxPoints === null || maxSeconds === null) {
      return;
    }
    setStarting(true);
    setStartError(null);
    setStartNotImplemented(false);
    setNotice(null);

    void createExperiment({
        variant_id: baseVariant.id,
        axes: checkY.axis === null ? [checkX.axis] : [checkX.axis, checkY.axis],
        budget: { max_points: maxPoints, max_seconds: maxSeconds },
        routing_policy: policy,
      }).then(
        (experiment) => {
          setStarting(false);
          restoredFor.current = experiment.id;
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set(EXPERIMENT_PARAM, experiment.id);
            return next;
          });
          setSelectedPointId(null);
        },
        (error: unknown) => {
          setStarting(false);
          setStartError(describe(error));
          setStartNotImplemented(isNotImplemented(error));
        },
      );
  }, [baseVariant, checkX.axis, checkY.axis, maxPoints, maxSeconds, policy, setSearchParams]);

  const baseRunId = useMemo(() => {
    if (project.data === null || baseVariant === null) {
      return null;
    }
    const group = groupRuns(project.data).find((item) => item.variant.id === baseVariant.id);
    return group === undefined ? null : (pickRun(group, policy)?.id ?? null);
  }, [project.data, baseVariant, policy]);

  const compare = useCallback(
    (point: ExperimentPoint) => {
      const runId = point.run_id;
      if (runId === null || runId === undefined) {
        return;
      }
      const runs = baseRunId === null ? runId : `${baseRunId},${runId}`;
      navigate(`${sectionHref(COMPARISON_PATH, projectId)}&runs=${runs}`);
    },
    [baseRunId, navigate, projectId],
  );

  const openNetwork = useCallback(
    (point: ExperimentPoint) => {
      if (point.run_id !== null && point.run_id !== undefined) {
        navigate(`${NETWORK_PATH}/${projectId}?run=${point.run_id}`);
      }
    },
    [navigate, projectId],
  );

  const materialize = useCallback(
    (point: ExperimentPoint) => {
      if (experimentId === null) {
        return;
      }
      setMaterializing(true);
      setNotice(null);
      void materializePoint(experimentId, point.id, pointVariantTitle(point)).then(
        (variant) => {
          setMaterializing(false);
          setNotice(`Точка сохранена вариантом «${variant.title}».`);
          project.reload();
        },
        (error: unknown) => {
          setMaterializing(false);
          setNotice(describe(error));
        },
      );
    },
    [experimentId, project],
  );

  if (project.error !== null) {
    return (
      <Screen>
        <StateCard left={25} top={200} width={1869} height={420} stackedClassName="md:col-span-2">
          <ErrorBlock title="Проект не загрузился" message={project.error} onRetry={project.reload} />
        </StateCard>
      </Screen>
    );
  }

  if (project.data === null || baseVariant === null) {
    return (
      <Screen>
        <PageSkeleton />
      </Screen>
    );
  }

  const target = baseVariant.scenario.environment.target_availability;
  const selectedPoint =
    state.points.find((point) => point.id === selectedPointId) ??
    state.experiment?.best_points.find((point) => point.id === selectedPointId) ??
    null;
  const onRetry = startError === null ? state.reload : start;
  const blockState = (block: ResultBlock) =>
    resultState({ block, compact: block === 'runs' && !stacked, experimentId, startError, startNotImplemented, state, onRetry });
  // Оси карты — те, что перебирал сервис, а не текущие поля формы: после правки формы
  // точки прошлого эксперимента иначе искались бы по параметру, которого в них нет.
  const [experimentX, experimentY] = state.experiment?.axes ?? [];

  return (
    <Screen notice={notice}>
      <SetupCard
        baseVariant={baseVariant}
        options={options}
        axisX={axisX}
        axisY={axisY}
        checkX={checkX}
        checkY={checkY}
        policy={policy}
        budget={budget}
        budgetProblem={budgetProblem}
        running={
          state.experiment !== null &&
          (state.experiment.status === 'queued' || state.experiment.status === 'running')
            ? state.experiment
            : null
        }
        starting={starting}
        stackedClassName={PLACE.setup}
        onAxisX={setAxisX}
        onAxisY={setAxisY}
        onPolicy={setPolicy}
        onBudget={setBudget}
        onStart={start}
      />

      {blockState('heatmap') === null && state.experiment !== null ? (
        <>
          <HeatmapCard
            points={state.points}
            xPath={experimentX?.path ?? axisX.path}
            yPath={experimentY?.path ?? null}
            axisTitle={axisTitle}
            metric={metric}
            target={target}
            selectedPointId={selectedPointId}
            stackedClassName={PLACE.heatmap}
            onSelect={(point) => { setSelectedPointId(point.id); }}
            onMetric={setMetric}
          />
          <TradeoffCard
            points={state.points}
            target={target}
            selectedPointId={selectedPointId}
            stackedClassName={PLACE.tradeoff}
            onSelect={(point) => { setSelectedPointId(point.id); }}
          />
          <PointCard
            experiment={state.experiment}
            point={selectedPoint}
            target={target}
            axisTitle={axisTitle}
            materializing={materializing}
            stackedClassName={PLACE.point}
            onMaterialize={materialize}
            onCompare={compare}
            onOpenNetwork={openNetwork}
            onSelect={(point) => { setSelectedPointId(point.id); }}
          />
          <RunsCard
            experiment={state.experiment}
            points={state.points}
            policy={state.experiment.routing_policy}
            selectedPointId={selectedPointId}
            axisTitle={axisTitle}
            stackedClassName={PLACE.runs}
            onSelect={(point) => { setSelectedPointId(point.id); }}
            onMaterialize={materialize}
            onCompare={compare}
            onOpenNetwork={openNetwork}
          />
        </>
      ) : (
        <>
          <StateCard
            left={465}
            top={200}
            width={918}
            height={420}
            title="Тепловая карта конфигураций"
            stackedClassName={cx(PLACE.heatmap, 'min-h-[300px]')}
          >
            {blockState('heatmap')}
          </StateCard>
          <StateCard
            left={465}
            top={636}
            width={918}
            height={220}
            title="min доступность и максимальное окно недоступности"
            stackedClassName={cx(PLACE.tradeoff, 'min-h-[200px]')}
          >
            {blockState('tradeoff')}
          </StateCard>
          <StateCard
            left={1403}
            top={200}
            width={491}
            height={656}
            label="ВЫБРАННАЯ ТОЧКА"
            stackedClassName={cx(PLACE.point, 'min-h-[260px]')}
          >
            {blockState('point')}
          </StateCard>
          <RunsCard
            experiment={null}
            points={[]}
            policy={policy}
            selectedPointId={null}
            axisTitle={axisTitle}
            stackedClassName={PLACE.runs}
            onSelect={noop}
            onMaterialize={noop}
            onCompare={noop}
            onOpenNetwork={noop}
          >
            {blockState('runs')}
          </RunsCard>
        </>
      )}
    </Screen>
  );
}

function Screen({ children, notice }: { children: ReactNode; notice?: string | null }) {
  const stacked = useStacked();
  const hasNotice = notice !== undefined && notice !== null;

  if (stacked) {
    return (
      <PageRoot canvasClassName="absolute inset-0" className="md:grid md:grid-cols-2">
        <header className="flex flex-col gap-[4px] pt-[8px] md:col-span-2">
          <h1 className="text-title-l font-bold text-ink-primary md:text-heading-m">
            Исследование пространства решений
          </h1>
          <p className="text-caption text-ink-secondary">
            Перебор конфигураций по осям сценария · метрика min_client_availability
          </p>
          {hasNotice && (
            <p role="status" className="text-caption text-ink-primary">
              {notice}
            </p>
          )}
        </header>
        {children}
      </PageRoot>
    );
  }

  return (
    <PageRoot canvasClassName="absolute inset-0">
      <Block>
        <h1 className="absolute left-[36px] top-[110px] text-heading-m font-bold text-ink-primary">
          Исследование пространства решений
        </h1>
      </Block>
      <Block>
        <p className="absolute left-[36px] top-[158px] text-caption text-ink-secondary">
          Перебор конфигураций по осям сценария · метрика min_client_availability
        </p>
      </Block>
      {hasNotice && (
        <Block>
          <p
            role="status"
            title={notice}
            className="absolute left-[600px] top-[158px] w-[1280px] truncate text-caption text-ink-secondary"
          >
            {notice}
          </p>
        </Block>
      )}
      {children}
    </PageRoot>
  );
}

/** Карточка на месте блока результата, пока показывать в нём нечего. */
function StateCard({
  left,
  top,
  width,
  height,
  title,
  label,
  stackedClassName,
  children,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Заголовок блока: без него четыре одинаковых состояния не отличить друг от друга. */
  title?: string;
  /** Подпись капителью — там, где в макете у блока нет крупного заголовка. */
  label?: string;
  stackedClassName?: string;
  children: ReactNode;
}) {
  const stacked = useStacked();
  const heading =
    title !== undefined ? (
      <h2
        title={title}
        className={cx(
          'text-[18px] font-semibold text-ink-primary',
          !stacked && 'absolute left-[23px] right-[23px] top-[13px] truncate',
        )}
      >
        {title}
      </h2>
    ) : label !== undefined ? (
      <p
        className={cx(
          'text-[10px] font-semibold tracking-[0.8px] text-ink-muted',
          !stacked && 'absolute left-[23px] top-[19px]',
        )}
      >
        {label}
      </p>
    ) : null;

  if (stacked) {
    return (
      <Card className={cx('flex flex-col gap-[8px] p-[20px]', stackedClassName)}>
        {heading}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </Card>
    );
  }

  return (
    <Card sceneX={left} sceneY={top} className="absolute" style={{ left, top, width, height }}>
      {heading}
      <div className={cx('absolute inset-x-0 bottom-0', heading === null ? 'top-0' : 'top-[44px]')}>
        {children}
      </div>
    </Card>
  );
}

function PageSkeleton() {
  const stacked = useStacked();

  if (stacked) {
    return (
      <LoadingBlock label="Загрузка проекта">
        <div className="flex flex-col gap-[16px] md:grid md:grid-cols-2">
          <Skeleton className="h-[640px] rounded-2xl" />
          <Skeleton className="hidden h-[640px] rounded-2xl md:block" />
          <Skeleton className="h-[380px] rounded-2xl md:col-span-2" />
        </div>
      </LoadingBlock>
    );
  }

  return (
    <LoadingBlock label="Загрузка проекта">
      <div className="absolute left-[25px] top-[200px] flex gap-[16px]">
        <Skeleton className="h-[656px] w-[424px]" />
        <Skeleton className="h-[420px] w-[918px]" />
        <Skeleton className="h-[656px] w-[491px]" />
      </div>
    </LoadingBlock>
  );
}

type ResultBlock = 'heatmap' | 'tradeoff' | 'point' | 'runs';

/** Что говорит пустой блок: полное объяснение одно, остальные — чего именно в них ждать. */
const EMPTY_HINT: Record<ResultBlock, string> = {
  heatmap:
    'Задайте ось и бюджет в постановке и запустите перебор. Список прошлых экспериментов проекта показать нечем: такого запроса в API пока нет.',
  tradeoff:
    'Здесь появится по точке на каждую рассчитанную конфигурацию: доступность худшего клиента против самого длинного перерыва.',
  point:
    'Когда перебор посчитает первые точки, выберите ячейку карты, чтобы увидеть показатели конфигурации.',
  runs: 'Прогоны появятся здесь по мере расчёта точек.',
};

/**
 * Состояние карточек результата: пока эксперимент не поставлен — пусто, пока endpoint
 * отвечает 501 — «не подключено» с повтором, при любой другой ошибке — сообщение сервиса.
 * Полоса прогонов на полотне получает однострочный вариант: столбик в ней обрезается краем.
 */
function resultState({
  block,
  compact,
  experimentId,
  startError,
  startNotImplemented,
  state,
  onRetry,
}: {
  block: ResultBlock;
  /** Однострочный вариант для низкой полосы прогонов на полотне. */
  compact: boolean;
  experimentId: string | null;
  startError: string | null;
  startNotImplemented: boolean;
  state: { error: string | null; notImplemented: boolean; loading: boolean };
  onRetry: () => void;
}): ReactNode | null {
  const notImplemented = startNotImplemented || state.notImplemented;
  const message = startError ?? state.error;

  if (message !== null) {
    return (
      <ErrorBlock
        title={notImplemented ? 'Расчёт экспериментов ещё не подключён' : 'Эксперимент не запустился'}
        message={message}
        onRetry={onRetry}
        compact={compact}
      />
    );
  }

  if (experimentId === null) {
    return <EmptyState title="Экспериментов ещё нет" hint={EMPTY_HINT[block]} compact={compact} />;
  }

  return state.loading ? <LoadingSkeleton /> : null;
}

function LoadingSkeleton() {
  return (
    <LoadingBlock label="Загрузка точек эксперимента">
      <div className="flex h-full min-h-[120px] flex-col gap-[10px] px-[23px] pb-[20px] pt-[4px]">
        <Skeleton className="h-[24px] w-1/3" />
        <Skeleton className="min-h-[80px] w-full flex-1" />
      </div>
    </LoadingBlock>
  );
}

function budgetMessage(
  maxPoints: number | null,
  maxSeconds: number | null,
  gridPoints: number,
): string | null {
  if (maxPoints === null) {
    return 'бюджет точек — целое число больше нуля';
  }
  if (maxSeconds === null) {
    return 'бюджет времени — целое число секунд больше нуля';
  }
  if (gridPoints > maxPoints) {
    return `сетка даёт ${gridPoints} точек — больше бюджета в ${maxPoints}: увеличьте шаг или сузьте диапазон`;
  }
  return null;
}

/** Черновик формы из оси, которую уже перебирал сервис. */
function draftOfAxis(axis: ExperimentAxis): AxisDraft {
  return { path: axis.path, from: String(axis.from), to: String(axis.to), step: String(axis.step) };
}

/** Название варианта из точки: параметры перебора и есть то, чем он отличается. */
function pointVariantTitle(point: ExperimentPoint): string {
  return Object.entries(point.params)
    .map(([path, value]) => `${path.split('.').at(-1) ?? path} ${value}`)
    .join(', ');
}

function noop(): void {
  // Карточки состояния не обрабатывают действий: в них нет ни одной строки.
}
