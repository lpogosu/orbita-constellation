import { useCallback, useEffect, useRef, useState } from 'react';

import { experimentsApi, isNotImplemented } from '@/api/experiments';
import type { Experiment, ExperimentPoint } from '@/api/types';
import { describe } from '@/lib/use-resource';

/** Пауза между опросами незавершённого перебора: точки появляются по мере готовности. */
const POLL_MS = 2000;

export interface ExperimentState {
  readonly experiment: Experiment | null;
  readonly points: readonly ExperimentPoint[];
  readonly error: string | null;
  /** Endpoint объявлен, но ещё не реализован (501): это не поломка, а незаконченный бэкенд. */
  readonly notImplemented: boolean;
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Состояние одного эксперимента: статус, прогресс и его точки.
 *
 * Опрос не пользуется общим `useResource` намеренно: тот на каждой попытке обнуляет
 * данные, и экран мигал бы пустотой каждые две секунды. Здесь прошлый ответ остаётся на
 * месте, пока не пришёл новый.
 */
export function useExperiment(experimentId: string | null): ExperimentState {
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [points, setPoints] = useState<readonly ExperimentPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notImplemented, setNotImplemented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const timer = useRef<number | null>(null);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (experimentId === null) {
      setExperiment(null);
      setPoints([]);
      setError(null);
      setNotImplemented(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchOnce = (): void => {
      void Promise.all([
        experimentsApi.get(experimentId),
        experimentsApi.points(experimentId),
      ]).then(
        ([nextExperiment, nextPoints]) => {
          if (cancelled) {
            return;
          }
          setExperiment(nextExperiment);
          setPoints(nextPoints);
          setError(null);
          setNotImplemented(false);
          setLoading(false);

          const unfinished =
            nextExperiment.status === 'queued' || nextExperiment.status === 'running';
          if (unfinished) {
            timer.current = window.setTimeout(fetchOnce, POLL_MS);
          }
        },
        (cause: unknown) => {
          if (cancelled) {
            return;
          }
          setError(describe(cause));
          setNotImplemented(isNotImplemented(cause));
          setLoading(false);
        },
      );
    };

    fetchOnce();

    return () => {
      cancelled = true;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [experimentId, attempt]);

  return { experiment, points, error, notImplemented, loading, reload };
}
