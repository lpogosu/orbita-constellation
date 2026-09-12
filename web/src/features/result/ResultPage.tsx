import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getProject, getVariant } from '@/api/projects';
import {
  createRun,
  getRunMetrics,
  getRunOutages,
  getRunSnapshot,
  getRunTimeline,
} from '@/api/runs';
import type {
  OutageInterval,
  RoutingPolicy,
  RunMetrics,
  RunTimeline,
  Snapshot,
  Variant,
} from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { RESULT_PATH } from '@/app/sections';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { describe, useResource } from '@/lib/use-resource';
import { ChangedParametersCard } from './ChangedParametersCard';
import { ClientStatCards } from './ClientStatCards';
import { OutageWindowsCard } from './OutageWindowsCard';
import { ResultHeader } from './ResultHeader';
import { RouteCoverageCard } from './RouteCoverageCard';
import { RunProgressCard } from './RunProgressCard';
import { SaveExportCard } from './SaveExportCard';
import { TimelineCard } from './TimelineCard';
import { useRun, waitForRun } from './use-run';

/** Первый отсчёт горизонта: мини-карта показывает сеть на нём (`14_SCREENS.md` §4). */
const FIRST_TICK_S = 0;

interface ResultBundle {
  readonly metrics: RunMetrics;
  readonly timeline: RunTimeline;
  readonly outages: readonly OutageInterval[];
  readonly snapshot: Snapshot;
}

/**
 * Экран «06 · Результат расчёта» (узел Figma 49:541) на полотне 1920×1080. Блоки стоят по
 * макетным координатам; пока запуск не завершён, их место занимает прогресс — данных для
 * них ещё нет.
 */
export function ResultPage() {
  const { runId = '' } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { select } = useProjectSelection();

  const { run, error: runError, reload: reloadRun } = useRun(runId);
  const variantId = run?.variant_id ?? null;
  const succeeded = run?.status === 'succeeded';

  const loadVariant = useCallback(
    (): Promise<Variant | null> => (variantId === null ? Promise.resolve(null) : getVariant(variantId)),
    [variantId],
  );
  const variant = useResource<Variant | null>(loadVariant);

  const loadResults = useCallback((): Promise<ResultBundle | null> => {
    if (!succeeded) {
      return Promise.resolve(null);
    }
    return Promise.all([
      getRunMetrics(runId),
      getRunTimeline(runId),
      getRunOutages(runId),
      getRunSnapshot(runId, FIRST_TICK_S),
    ]).then(([metrics, timeline, outages, snapshot]) => ({
      metrics,
      timeline,
      outages,
      snapshot,
    }));
  }, [runId, succeeded]);
  const results = useResource<ResultBundle | null>(loadResults);

  const projectId = variant.data?.project_id ?? null;
  const loadProjectTitle = useCallback(
    (): Promise<string | null> =>
      projectId === null ? Promise.resolve(null) : getProject(projectId).then((d) => d.project.title),
    [projectId],
  );
  const projectTitle = useResource<string | null>(loadProjectTitle);

  // Шапка показывает «Проект › Вариант» по тому, что открыто; проект известен через
  // вариант запуска, поэтому выбор сообщается после его загрузки.
  useEffect(() => {
    select({ projectId, variantId, runId });
  }, [select, projectId, variantId, runId]);

  const openResult = useCallback(
    (newRunId: string) => {
      navigate(`${RESULT_PATH}/${newRunId}`);
    },
    [navigate],
  );
  const recompute = useRecompute(variantId, run?.routing_policy ?? 'bfs_shortest', openResult);

  if (runError !== null) {
    return (
      <Card
        sceneX={37}
        sceneY={249}
        className="absolute left-[37px] top-[249px] h-[400px] w-[1295px]"
      >
        <ErrorBlock title="Расчёт не загрузился" message={runError} onRetry={reloadRun} />
      </Card>
    );
  }

  if (run === null) {
    return (
      <LoadingBlock label="Загружаем расчёт">
        <Skeleton className="absolute left-[43px] top-[126px] h-[86px] w-[1290px] rounded-2xl" />
        <Skeleton className="absolute left-[37px] top-[249px] h-[806px] w-[1295px] rounded-2xl" />
        <Skeleton className="absolute left-[1373px] top-[112px] h-[916px] w-[508px] rounded-2xl" />
      </LoadingBlock>
    );
  }

  const bundle = results.data;

  return (
    <>
      <ResultHeader run={run} variant={variant.data} />

      {run.status === 'succeeded' ? (
        <>
          <ClientStatCards
            clients={bundle?.metrics.clients ?? null}
            targetAvailability={variant.data?.scenario.environment.target_availability ?? null}
            error={results.error}
            onRetry={results.reload}
          />
          <ChangedParametersCard
            variant={variant.data}
            error={variant.error}
            onRetry={variant.reload}
          />
          <RouteCoverageCard
            snapshot={bundle?.snapshot ?? null}
            clients={bundle?.metrics.clients ?? null}
            meanHops={bundle?.metrics.config.mean_hops ?? null}
            projectId={projectId}
            variantId={variantId}
            error={results.error}
            onRetry={results.reload}
          />
          <TimelineCard
            timeline={bundle?.timeline ?? null}
            error={results.error}
            onRetry={results.reload}
          />
        </>
      ) : (
        <RunProgressCard
          run={run}
          onRetry={recompute.startWithCurrentPolicy}
          retrying={recompute.progressLabel !== null}
          retryError={recompute.error}
        />
      )}

      <SaveExportCard
        run={run}
        variant={variant.data}
        projectId={projectId}
        projectTitle={projectTitle.data}
        recompute={recompute}
      />

      {run.status === 'succeeded' && (
        <OutageWindowsCard
          outages={bundle?.outages ?? null}
          error={results.error}
          onRetry={results.reload}
          projectId={projectId}
        />
      )}
    </>
  );
}

interface Recompute {
  readonly policy: RoutingPolicy;
  readonly onPolicyChange: (policy: RoutingPolicy) => void;
  readonly onStart: () => void;
  readonly startWithCurrentPolicy: () => void;
  readonly progressLabel: string | null;
  readonly error: string | null;
}

/**
 * Запуск того же варианта с выбранной политикой и ожидание его конца. Переход на новый
 * результат откладывается до `succeeded`: иначе пользователь нажимает кнопку и попадает
 * на экран, где вместо ответа снова прогресс.
 */
function useRecompute(
  variantId: string | null,
  currentPolicy: RoutingPolicy,
  onDone: (runId: string) => void,
): Recompute {
  // Предложена «Дейкстра», как в макете: смысл кнопки — сравнить с другой политикой, а
  // не повторить ту же, и выбранная по умолчанию отличается от политики этого запуска.
  const [policy, setPolicy] = useState<RoutingPolicy>('dijkstra_distance');
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const start = useCallback(
    (requested: RoutingPolicy) => {
      if (variantId === null) {
        return;
      }
      cancelled.current = false;
      setError(null);
      setProgressLabel('Ставим в очередь…');

      void createRun({ variant_id: variantId, routing_policy: requested })
        .then((created) =>
          waitForRun(
            created.id,
            (run) => {
              setProgressLabel(`Считаем… ${String(Math.round(run.progress * 100))} %`);
            },
            () => cancelled.current,
          ),
        )
        .then((finished) => {
          if (cancelled.current) {
            return;
          }
          setProgressLabel(null);
          if (finished.status === 'succeeded') {
            onDone(finished.id);
          } else {
            setError(finished.error?.message ?? `Расчёт завершился со статусом «${finished.status}»`);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled.current) {
            setProgressLabel(null);
            setError(describe(cause));
          }
        });
    },
    [variantId, onDone],
  );

  const onStart = useCallback(() => {
    start(policy);
  }, [start, policy]);

  const startWithCurrentPolicy = useCallback(() => {
    start(currentPolicy);
  }, [start, currentPolicy]);

  return { policy, onPolicyChange: setPolicy, onStart, startWithCurrentPolicy, progressLabel, error };
}
