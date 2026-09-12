import { useCallback, useEffect, useState } from 'react';

import { getRun } from '@/api/runs';
import type { Run } from '@/api/types';
import { describe } from '@/lib/use-resource';

/**
 * Секунда между опросами: `GET /api/runs/{id}` — запасной путь к прогрессу (`05_API.md`
 * §4), основной — SSE, и он появится вместе с экраном «Сеть». Чаще опрашивать незачем:
 * расчёт суток занимает секунды, а стадия меняется реже.
 */
const POLL_MS = 1000;

function isPending(run: Run): boolean {
  return run.status === 'queued' || run.status === 'running';
}

export interface RunResource {
  readonly run: Run | null;
  readonly error: string | null;
  readonly reload: () => void;
}

/** Статус запуска с опросом, пока он не завершился. */
export function useRun(runId: string): RunResource {
  const [state, setState] = useState<{ run: Run | null; error: string | null }>({
    run: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;

    const poll = (): void => {
      void getRun(runId).then(
        (run) => {
          if (stopped) {
            return;
          }
          setState({ run, error: null });
          if (isPending(run)) {
            timer = window.setTimeout(poll, POLL_MS);
          }
        },
        (error: unknown) => {
          if (!stopped) {
            setState({ run: null, error: describe(error) });
          }
        },
      );
    };

    setState({ run: null, error: null });
    poll();

    return () => {
      stopped = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [runId, attempt]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { run: state.run, error: state.error, reload };
}

/**
 * Ждёт завершения запуска тем же опросом. Нужна кнопке «Пересчитать с другой политикой»:
 * переходить на новый результат до `succeeded` нельзя, иначе пользователь видит пустой
 * экран вместо ответа на своё действие.
 */
export async function waitForRun(
  runId: string,
  onProgress: (run: Run) => void,
  isCancelled: () => boolean,
): Promise<Run> {
  for (;;) {
    const run = await getRun(runId);
    if (isCancelled()) {
      return run;
    }
    onProgress(run);
    if (!isPending(run)) {
      return run;
    }
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
  }
}
