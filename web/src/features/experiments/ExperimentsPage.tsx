import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  createExperiment,
  isNotImplemented,
  materializePoint,
} from '@/api/experiments';
import { getProject } from '@/api/projects';
import type { ExperimentPoint, ProjectDetail, RoutingPolicy, Variant } from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { COMPARISON_PATH, NETWORK_PATH } from '@/app/sections';
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

const EMPTY_AXIS: AxisDraft = { path: NO_AXIS, from: '', to: '', step: '' };
const DEFAULT_BUDGET: BudgetDraft = { maxPoints: '100', maxSeconds: '600' };

/**
 * Экран «07 · Исследования» (узел Figma `142:1075`). Координаты блоков — макетные:
 * постановка 424×656 на (25, 200), тепловая карта 918×420 на (465, 200), график
 * компромиссов 918×220 на (465, 636), выбранная точка 491×656 на (1403, 200) и прогоны
 * 1858×184 на (25, 872).
 *
 * Endpoint перебора сейчас отвечают 501: форма постановки остаётся рабочей, а блоки
 * результата честно говорят, что расчёт ещё не подключён. Подставлять вместо него
 * придуманные точки нельзя — по ним будут принимать инженерное решение.
 */
export function ExperimentsPage() {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string }>();
  // Пункт меню ведёт на «/experiments» без проекта: тогда экран берёт текущий выбор,
  // сделанный на «Проектах» или «Результате».
  const { selection, select } = useProjectSelection();
  const projectId = params.projectId ?? selection.projectId ?? '';

  const loadProject = useCallback(() => getProject(projectId), [projectId]);
  const project = useResource<ProjectDetail>(loadProject);

  const [axisX, setAxisX] = useState<AxisDraft>(EMPTY_AXIS);
  const [axisY, setAxisY] = useState<AxisDraft>(EMPTY_AXIS);
  const [policy, setPolicy] = useState<RoutingPolicy>('bfs_shortest');
  const [budget, setBudget] = useState<BudgetDraft>(DEFAULT_BUDGET);
  const [metric, setMetric] = useState<PointMetric>('min_client_availability');

  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [startNotImplemented, setStartNotImplemented] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [materializing, setMaterializing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const state = useExperiment(experimentId);

  const baseVariant = useMemo<Variant | null>(() => {
    if (project.data === null) {
      return null;
    }
    const active = project.data.variants.find(
      (variant) => variant.id === project.data?.project.active_variant_id,
    );
    return active ?? project.data.variants[0] ?? null;
  }, [project.data]);

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
          setExperimentId(experiment.id);
          setSelectedPointId(null);
        },
        (error: unknown) => {
          setStarting(false);
          setStartError(describe(error));
          setStartNotImplemented(isNotImplemented(error));
        },
      );
  }, [baseVariant, checkX.axis, checkY.axis, maxPoints, maxSeconds, policy]);

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
      navigate(`${COMPARISON_PATH}?project=${projectId}&runs=${runs}`);
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
        <StateCard left={25} top={200} width={1869} height={420}>
          <ErrorBlock title="Проект не загрузился" message={project.error} onRetry={project.reload} />
        </StateCard>
      </Screen>
    );
  }

  if (project.data === null || baseVariant === null) {
    return (
      <Screen>
        <LoadingBlock label="Загрузка проекта">
          <div className="absolute left-[25px] top-[200px] flex gap-[16px]">
            <Skeleton className="h-[656px] w-[424px]" />
            <Skeleton className="h-[420px] w-[918px]" />
            <Skeleton className="h-[656px] w-[491px]" />
          </div>
        </LoadingBlock>
      </Screen>
    );
  }

  const target = baseVariant.scenario.environment.target_availability;
  const selectedPoint =
    state.points.find((point) => point.id === selectedPointId) ??
    state.experiment?.best_points.find((point) => point.id === selectedPointId) ??
    null;
  const resultBlock = resultState({
    experimentId,
    startError,
    startNotImplemented,
    state,
    onRetry: startError === null ? state.reload : start,
  });

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
        onAxisX={setAxisX}
        onAxisY={setAxisY}
        onPolicy={setPolicy}
        onBudget={setBudget}
        onStart={start}
      />

      {resultBlock === null && state.experiment !== null ? (
        <>
          <HeatmapCard
            points={state.points}
            xPath={axisX.path}
            yPath={axisY.path === NO_AXIS ? null : axisY.path}
            axisTitle={axisTitle}
            metric={metric}
            target={target}
            selectedPointId={selectedPointId}
            onSelect={(point) => { setSelectedPointId(point.id); }}
            onMetric={setMetric}
          />
          <TradeoffCard
            points={state.points}
            target={target}
            selectedPointId={selectedPointId}
            onSelect={(point) => { setSelectedPointId(point.id); }}
          />
          <PointCard
            experiment={state.experiment}
            point={selectedPoint}
            target={target}
            axisTitle={axisTitle}
            materializing={materializing}
            onMaterialize={materialize}
            onCompare={compare}
            onOpenNetwork={openNetwork}
            onSelect={(point) => { setSelectedPointId(point.id); }}
          />
          <RunsCard
            experiment={state.experiment}
            points={state.points}
            policy={policy}
            selectedPointId={selectedPointId}
            axisTitle={axisTitle}
            onSelect={(point) => { setSelectedPointId(point.id); }}
            onMaterialize={materialize}
            onCompare={compare}
            onOpenNetwork={openNetwork}
          />
        </>
      ) : (
        <>
          <StateCard left={465} top={200} width={918} height={420}>
            {resultBlock}
          </StateCard>
          <StateCard left={465} top={636} width={918} height={220}>
            {resultBlock}
          </StateCard>
          <StateCard left={1403} top={200} width={491} height={656}>
            {resultBlock}
          </StateCard>
          <RunsCard
            experiment={null}
            points={[]}
            policy={policy}
            selectedPointId={null}
            axisTitle={axisTitle}
            onSelect={noop}
            onMaterialize={noop}
            onCompare={noop}
            onOpenNetwork={noop}
          >
            {resultBlock}
          </RunsCard>
        </>
      )}
    </Screen>
  );
}

function Screen({ children, notice }: { children: ReactNode; notice?: string | null }) {
  return (
    <div className="absolute inset-0">
      <h1 className="absolute left-[36px] top-[110px] text-heading-m font-bold text-ink-primary">
        Исследование пространства решений
      </h1>
      <p className="absolute left-[36px] top-[158px] text-caption text-ink-secondary">
        Перебор конфигураций по осям сценария · метрика min_client_availability
      </p>
      {notice !== undefined && notice !== null && (
        <p role="status" className="absolute left-[600px] top-[158px] text-caption text-ink-secondary">
          {notice}
        </p>
      )}
      {children}
    </div>
  );
}

function StateCard({
  left,
  top,
  width,
  height,
  children,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  children: ReactNode;
}) {
  return (
    <Card sceneX={left} sceneY={top} className="absolute" style={{ left, top, width, height }}>
      {children}
    </Card>
  );
}

/**
 * Один и тот же блок состояния во всех карточках результата: пока эксперимент не
 * поставлен — пусто, пока endpoint отвечает 501 — «не подключено» с повтором, при любой
 * другой ошибке — сообщение сервиса.
 */
function resultState({
  experimentId,
  startError,
  startNotImplemented,
  state,
  onRetry,
}: {
  experimentId: string | null;
  startError: string | null;
  startNotImplemented: boolean;
  state: { error: string | null; notImplemented: boolean; loading: boolean };
  onRetry: () => void;
}): ReactNode | null {
  const notImplemented = startNotImplemented || state.notImplemented;
  const message = startError ?? state.error;

  if (notImplemented && message !== null) {
    return (
      <ErrorBlock
        title="Расчёт экспериментов ещё не подключён"
        message={message}
        onRetry={onRetry}
        retryLabel="Повторить"
      />
    );
  }

  if (message !== null) {
    return <ErrorBlock title="Эксперимент не запустился" message={message} onRetry={onRetry} />;
  }

  if (experimentId === null) {
    return (
      <EmptyState
        title="Экспериментов ещё нет"
        hint="Задайте ось и бюджет слева и запустите перебор. Список прошлых экспериментов проекта показать нечем: такого запроса в API пока нет."
      />
    );
  }

  return state.loading ? <LoadingSkeleton /> : null;
}

function LoadingSkeleton() {
  return (
    <LoadingBlock label="Загрузка точек эксперимента">
      <div className="flex h-full flex-col gap-[10px] p-[23px]">
        <Skeleton className="h-[24px] w-1/3" />
        <Skeleton className="h-full w-full" />
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

/** Название варианта из точки: параметры перебора и есть то, чем он отличается. */
function pointVariantTitle(point: ExperimentPoint): string {
  return Object.entries(point.params)
    .map(([path, value]) => `${path.split('.').at(-1) ?? path} ${value}`)
    .join(', ');
}

function noop(): void {
  // Карточки состояния не обрабатывают действий: в них нет ни одной строки.
}
