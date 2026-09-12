import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { networkApi } from '@/api/network';
import { outagesApi } from '@/api/outages';
import type {
  OutageInterval,
  ProjectDetail,
  Run,
  RunMetrics,
  RunTimeline,
  RoutingPolicy,
  Scenario,
  Snapshot,
  Variant,
} from '@/api/types';
import { useProjectSelection } from '@/app/project-selection';
import { describe } from '@/lib/use-resource';
import { draftChanges } from './draft';
import type { DraftChange } from './draft';
import { useRunControl } from './use-run';
import type { RunControl } from './use-run';

/** Задержка автообновления предпросмотра после правки параметра (`14_SCREENS.md` §2.1). */
const PREVIEW_DEBOUNCE_MS = 500;

/**
 * Позиция, с которой открыт экран: она приходит в адресе (`run`, `t`) и применяется один
 * раз, при входе. Дальше отсчётом и расчётом распоряжается сам экран, иначе ссылка,
 * оставшаяся в адресной строке, возвращала бы пользователя назад на каждую перерисовку.
 */
export interface SceneEntry {
  readonly runId: string | null;
  readonly tS: number | null;
}

export interface SceneState {
  readonly project: ProjectDetail | null;
  readonly projectError: string | null;
  readonly reloadProject: () => void;

  readonly variant: Variant | null;
  readonly draft: Scenario | null;
  readonly setDraft: (scenario: Scenario) => void;
  readonly resetDraft: () => void;
  readonly changes: readonly DraftChange[];
  readonly dirty: boolean;

  readonly policy: RoutingPolicy;
  readonly setPolicy: (policy: RoutingPolicy) => void;

  readonly runControl: RunControl;
  readonly run: Run | null;
  readonly runReady: boolean;

  readonly tS: number;
  readonly seek: (tS: number) => void;
  readonly totalTicks: number;
  readonly stepS: number;

  readonly snapshot: Snapshot | null;
  readonly snapshotSource: 'run' | 'preview';
  readonly snapshotError: string | null;

  readonly timeline: RunTimeline | null;
  readonly metrics: RunMetrics | null;
  readonly outages: readonly OutageInterval[] | null;
  readonly resultsError: string | null;
  readonly reloadResults: () => void;

  readonly selectedClientId: string | null;
  readonly selectClient: (clientId: string | null) => void;

  readonly selectVariant: (variantId: string) => void;
  readonly saveVariant: (title: string, scenario?: Scenario) => Promise<Variant | null>;
}

/**
 * Данные обоих экранов: проект и его вариант, черновик поверх варианта, расчёт и всё, что
 * к нему привязано. Хук ничего не считает — он только решает, какой источник показывать
 * на текущем отсчёте: снимок расчёта или предпросмотр черновика (`14_SCREENS.md` §0.3).
 */
export function useNetworkScene(projectId: string, entry?: SceneEntry): SceneState {
  const { selection, select } = useProjectSelection();

  const entryRunId = entry?.runId ?? null;
  // Расчёт из адреса подставляется только первым: после «Запустить расчёт» экран живёт
  // своим прогоном, а прежний идентификатор в запросе уже не команда.
  const entryRunUsed = useRef(false);

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectAttempt, setProjectAttempt] = useState(0);

  const [variant, setVariant] = useState<Variant | null>(null);
  const [draft, setDraftState] = useState<Scenario | null>(null);
  const [policy, setPolicy] = useState<RoutingPolicy>('bfs_shortest');
  const [tS, setTS] = useState(entry?.tS ?? 0);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<'run' | 'preview'>('preview');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [timeline, setTimeline] = useState<RunTimeline | null>(null);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [outages, setOutages] = useState<readonly OutageInterval[] | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [resultsAttempt, setResultsAttempt] = useState(0);

  // Идентификатор расчёта, на события которого экран уже подписан.
  const attached = useRef<string | null>(null);
  const runControl = useRunControl();
  const { attach, reset: resetRun } = runControl;
  const run = runControl.run;
  const runReady = run !== null && run.status === 'succeeded';

  useEffect(() => {
    select({ projectId, variantId: variant?.id ?? null, runId: run?.id ?? null });
  }, [select, projectId, variant, run]);

  useEffect(() => {
    let active = true;
    setProject(null);
    setProjectError(null);
    void networkApi.getProject(projectId).then(
      (detail) => {
        if (active) {
          setProject(detail);
        }
      },
      (cause: unknown) => {
        if (active) {
          setProjectError(describe(cause));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, projectAttempt]);

  // Вариант берётся из ответа проекта: он приходит вместе со сценарием, отдельный запрос
  // нужен только тому варианту, которого в списке нет (например, только что созданному).
  const selectVariant = useCallback(
    (variantId: string) => {
      // Расчёт принадлежит варианту: показывать его результаты рядом с другим вариантом
      // нельзя, поэтому при смене варианта он сбрасывается вместе с черновиком.
      resetRun();
      attached.current = null;
      const known = project?.variants.find((item) => item.id === variantId);
      if (known !== undefined) {
        setVariant(known);
        setDraftState(known.scenario);
        return;
      }
      void networkApi.getVariant(variantId).then(
        (fresh) => {
          setVariant(fresh);
          setDraftState(fresh.scenario);
        },
        (cause: unknown) => {
          setProjectError(describe(cause));
        },
      );
    },
    [project, resetRun],
  );

  useEffect(() => {
    if (project === null || variant !== null) {
      return;
    }
    // Вариант расчёта из адреса важнее последнего выбранного: переход «показать эту
    // точку» обязан открыть тот вариант, которому точка принадлежит.
    const wanted =
      (entryRunId === null
        ? null
        : (project.recent_runs.find((item) => item.id === entryRunId)?.variant_id ?? null)) ??
      selection.variantId ??
      project.project.active_variant_id;
    const chosen =
      project.variants.find((item) => item.id === wanted) ?? project.variants[0] ?? null;
    if (chosen !== null) {
      setVariant(chosen);
      setDraftState(chosen.scenario);
    }
  }, [project, variant, selection.variantId, entryRunId]);

  useEffect(() => {
    if (project === null || variant === null) {
      return;
    }
    const requested = entryRunUsed.current ? null : entryRunId;
    const wanted =
      requested ??
      selection.runId ??
      project.recent_runs.find(
        (item) => item.variant_id === variant.id && item.status === 'succeeded',
      )?.id ??
      null;
    // Запуск, поставленный с этого же экрана, уже слушается: второй раз подписываться
    // на его события незачем.
    if (wanted !== null && attached.current !== wanted && run?.id !== wanted) {
      entryRunUsed.current = true;
      attached.current = wanted;
      attach(wanted);
    }
  }, [project, variant, selection.runId, entryRunId, attach, run]);

  const changes = useMemo(
    () => (variant === null || draft === null ? [] : draftChanges(variant.scenario, draft)),
    [variant, draft],
  );
  const dirty = changes.length > 0;

  const stepS = draft?.environment.step_s ?? 0;
  const totalTicks = useMemo(() => {
    if (run !== null && run.total_ticks > 0) {
      return run.total_ticks;
    }
    return draft === null ? 0 : Math.round(draft.environment.horizon_s / draft.environment.step_s);
  }, [run, draft]);

  const seek = useCallback((next: number) => {
    setTS(next);
  }, []);

  // Снимок: пока черновик совпадает с рассчитанным вариантом — из расчёта; как только
  // появилось отличие, карта переходит на предпросмотр черновика, а результаты за сутки
  // помечаются устаревшими.
  const previewTimer = useRef(0);
  useEffect(() => {
    if (draft === null) {
      return;
    }
    let active = true;
    const readyRun = run !== null && run.status === 'succeeded' && !dirty ? run : null;

    if (readyRun !== null) {
      setSnapshotSource('run');
      void networkApi.getSnapshot(readyRun.id, tS).then(
        (fresh) => {
          if (active) {
            setSnapshot(fresh);
            setSnapshotError(null);
          }
        },
        (cause: unknown) => {
          if (active) {
            setSnapshotError(describe(cause));
          }
        },
      );
      return () => {
        active = false;
      };
    }

    setSnapshotSource('preview');
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => {
      void networkApi.preview(draft, tS, policy).then(
        (fresh) => {
          if (active) {
            setSnapshot(fresh);
            setSnapshotError(null);
          }
        },
        (cause: unknown) => {
          if (active) {
            setSnapshotError(describe(cause));
          }
        },
      );
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(previewTimer.current);
    };
  }, [draft, dirty, run, tS, policy]);

  useEffect(() => {
    if (run === null || run.status !== 'succeeded') {
      setTimeline(null);
      setMetrics(null);
      setOutages(null);
      return;
    }
    let active = true;
    setResultsError(null);
    void Promise.all([
      networkApi.getTimeline(run.id),
      networkApi.getMetrics(run.id),
      outagesApi.getOutages(run.id),
    ]).then(
      ([freshTimeline, freshMetrics, freshOutages]) => {
        if (active) {
          setTimeline(freshTimeline);
          setMetrics(freshMetrics);
          setOutages(freshOutages);
        }
      },
      (cause: unknown) => {
        if (active) {
          setResultsError(describe(cause));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [run, resultsAttempt]);

  const setDraft = useCallback((scenario: Scenario) => {
    setDraftState(scenario);
  }, []);

  const resetDraft = useCallback(() => {
    if (variant !== null) {
      setDraftState(variant.scenario);
    }
  }, [variant]);

  const saveVariant = useCallback(
    async (title: string, scenario?: Scenario): Promise<Variant | null> => {
      const source = scenario ?? draft;
      if (source === null) {
        return null;
      }
      const created = await networkApi.createVariant(projectId, {
        title,
        scenario: source,
        parent_variant_id: variant?.id ?? null,
      });
      setVariant(created);
      setDraftState(created.scenario);
      setProjectAttempt((value) => value + 1);
      return created;
    },
    [draft, projectId, variant],
  );

  return {
    project,
    projectError,
    reloadProject: useCallback(() => {
      setProjectAttempt((value) => value + 1);
    }, []),
    variant,
    draft,
    setDraft,
    resetDraft,
    changes,
    dirty,
    policy,
    setPolicy,
    runControl,
    run,
    runReady,
    tS,
    seek,
    totalTicks,
    stepS,
    snapshot,
    snapshotSource,
    snapshotError,
    timeline,
    metrics,
    outages,
    resultsError,
    reloadResults: useCallback(() => {
      setResultsAttempt((value) => value + 1);
    }, []),
    selectedClientId,
    selectClient: setSelectedClientId,
    selectVariant,
    saveVariant,
  };
}
