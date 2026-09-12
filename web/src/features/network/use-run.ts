import { useCallback, useEffect, useRef, useState } from 'react';

import { networkApi, subscribeRunEvents } from '@/api/network';
import type { RunEventsSubscription } from '@/api/network';
import type { Run, RoutingPolicy, RunStage } from '@/api/types';
import { describe } from '@/lib/use-resource';

export const STAGE_LABEL: Record<RunStage, string> = {
  validate: 'Проверка',
  geometry: 'Геометрия',
  contacts: 'Контакты',
  routing: 'Маршрутизация',
  analytics: 'Аналитика',
  persist: 'Сохранение',
  complete: 'Готово',
};

const STAGE_ORDER: readonly RunStage[] = [
  'validate',
  'geometry',
  'contacts',
  'routing',
  'analytics',
  'persist',
  'complete',
];

export function stageStep(stage: RunStage): string {
  return `шаг ${STAGE_ORDER.indexOf(stage) + 1} из ${STAGE_ORDER.length}`;
}

export interface RunControl {
  readonly run: Run | null;
  readonly starting: boolean;
  readonly error: string | null;
  readonly start: (variantId: string, policy: RoutingPolicy) => void;
  readonly attach: (runId: string) => void;
  readonly cancel: () => void;
  readonly reset: () => void;
  readonly clearError: () => void;
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Жизненный цикл расчёта: постановка, поток прогресса и отмена. Прогресс приходит по SSE
 * (`05_API.md` §4); если поток закрылся раньше конечного статуса, состояние добирается
 * запросом `GET /api/runs/{id}` — запасной путь предусмотрен контрактом.
 */
export function useRunControl(onFinished?: (run: Run) => void): RunControl {
  const [run, setRun] = useState<Run | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscription = useRef<RunEventsSubscription | null>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const listen = useCallback((runId: string) => {
    subscription.current?.close();
    subscription.current = subscribeRunEvents(
      runId,
      (event) => {
        setRun((current) =>
          current === null || current.id !== runId
            ? current
            : {
                ...current,
                status: event.status,
                stage: event.stage,
                progress: event.progress,
                completed_ticks: event.completed_ticks,
                total_ticks: event.total_ticks,
              },
        );
        if (event.status !== 'queued' && event.status !== 'running') {
          // Поток отдаёт только прогресс; итоговые поля (ошибка, длительность, trace_uri)
          // лежат в самом Run, поэтому он перечитывается один раз по завершении.
          void networkApi.getRun(runId).then(
            (fresh) => {
              setRun(fresh);
              finished.current?.(fresh);
            },
            (cause: unknown) => {
              setError(describe(cause));
            },
          );
        }
      },
      () => {
        void networkApi.getRun(runId).then(
          (fresh) => {
            setRun(fresh);
            if (fresh.status !== 'queued' && fresh.status !== 'running') {
              finished.current?.(fresh);
            }
          },
          (cause: unknown) => {
            setError(describe(cause));
          },
        );
      },
    );
  }, []);

  const attach = useCallback(
    (runId: string) => {
      void networkApi.getRun(runId).then(
        (fresh) => {
          setRun(fresh);
          if (fresh.status === 'queued' || fresh.status === 'running') {
            listen(runId);
          } else {
            finished.current?.(fresh);
          }
        },
        (cause: unknown) => {
          setError(describe(cause));
        },
      );
    },
    [listen],
  );

  const start = useCallback(
    (variantId: string, policy: RoutingPolicy) => {
      setStarting(true);
      setError(null);
      void networkApi.createRun(variantId, policy, newIdempotencyKey()).then(
        (created) => {
          setStarting(false);
          setRun(created);
          if (created.status === 'queued' || created.status === 'running') {
            listen(created.id);
          } else {
            finished.current?.(created);
          }
        },
        (cause: unknown) => {
          setStarting(false);
          setError(describe(cause));
        },
      );
    },
    [listen],
  );

  const cancel = useCallback(() => {
    if (run === null) {
      return;
    }
    void networkApi.cancelRun(run.id).then(setRun, (cause: unknown) => {
      setError(describe(cause));
    });
  }, [run]);

  useEffect(
    () => () => {
      subscription.current?.close();
    },
    [],
  );

  const reset = useCallback(() => {
    subscription.current?.close();
    setRun(null);
    setError(null);
  }, []);

  return {
    run,
    starting,
    error,
    start,
    attach,
    cancel,
    reset,
    clearError: useCallback(() => {
      setError(null);
    }, []),
  };
}
