import { useCallback, useEffect, useState } from 'react';

import { networkApi } from '@/api/network';
import { outagesApi } from '@/api/outages';
import type {
  ComparisonEntry,
  CriticalityReport,
  RunTimeline,
  Snapshot,
} from '@/api/types';
import { ApiError } from '@/api/client';
import { describe } from '@/lib/use-resource';

/** Снимок произвольного расчёта на отсчёте: нужен половине «до» на экране сравнения. */
export function useRunSnapshot(runId: string | null, tS: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runId === null) {
      setSnapshot(null);
      return;
    }
    let active = true;
    void networkApi.getSnapshot(runId, tS).then(
      (fresh) => {
        if (active) {
          setSnapshot(fresh);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (active) {
          setError(describe(cause));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [runId, tS]);

  return { snapshot, error };
}

export function useRunTimeline(runId: string | null) {
  const [timeline, setTimeline] = useState<RunTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runId === null) {
      setTimeline(null);
      return;
    }
    let active = true;
    void networkApi.getTimeline(runId).then(
      (fresh) => {
        if (active) {
          setTimeline(fresh);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (active) {
          setError(describe(cause));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [runId]);

  return { timeline, error };
}

export interface ComparisonState {
  /** База сравнения: у неё дельты пустые, но метрики клиентов «до» лежат здесь. */
  readonly base: ComparisonEntry | null;
  readonly entry: ComparisonEntry | null;
  readonly error: string | null;
  readonly loading: boolean;
}

/**
 * `POST /api/comparisons` с парой запусков. База — первый элемент, у неё дельты пустые,
 * поэтому экран читает второй: всё «что изменилось» живёт именно там (`05_API.md` §1).
 */
export function useComparison(baseRunId: string | null, otherRunId: string | null): ComparisonState {
  const [state, setState] = useState<ComparisonState>({
    base: null,
    entry: null,
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (baseRunId === null || otherRunId === null || baseRunId === otherRunId) {
      setState({ base: null, entry: null, error: null, loading: false });
      return;
    }
    let active = true;
    setState({ base: null, entry: null, error: null, loading: true });
    void outagesApi.compare([baseRunId, otherRunId]).then(
      (result) => {
        if (active) {
          setState({
            base: result.entries[0] ?? null,
            entry: result.entries[1] ?? null,
            error: null,
            loading: false,
          });
        }
      },
      (cause: unknown) => {
        if (active) {
          setState({ base: null, entry: null, error: describe(cause), loading: false });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [baseRunId, otherRunId]);

  return state;
}

export interface CriticalityState {
  readonly report: CriticalityReport | null;
  readonly error: string | null;
  /** 501: endpoint объявлен, но не реализован — это не ошибка пользователя. */
  readonly notImplemented: boolean;
  readonly loading: boolean;
  readonly request: () => void;
}

export function useCriticality(runId: string | null): CriticalityState {
  const [report, setReport] = useState<CriticalityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notImplemented, setNotImplemented] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReport(null);
    setError(null);
    setNotImplemented(false);
  }, [runId]);

  const request = useCallback(() => {
    if (runId === null) {
      return;
    }
    setLoading(true);
    setError(null);
    setNotImplemented(false);
    void outagesApi.criticality(runId).then(
      (fresh) => {
        setLoading(false);
        setReport(fresh);
      },
      (cause: unknown) => {
        setLoading(false);
        if (cause instanceof ApiError && cause.status === 501) {
          setNotImplemented(true);
          setError(cause.message);
          return;
        }
        setError(describe(cause));
      },
    );
  }, [runId]);

  return { report, error, notImplemented, loading, request };
}
