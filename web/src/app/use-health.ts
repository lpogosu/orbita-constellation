import { useCallback, useEffect, useRef, useState } from 'react';

import { getHealth } from '@/api/health';
import type { HealthResponse } from '@/api/types';

const POLL_MS = 30_000;

export interface HealthState {
  /** `null`, пока первый ответ не пришёл или сервис не отвечает — баннер тогда молчит. */
  readonly health: HealthResponse | null;
  readonly refresh: () => void;
}

/**
 * `GET /api/health` опрашивается раз в 30 секунд — баннер деградации (`AppLayout`) должен
 * появиться и пропасть сам, без перезагрузки страницы. Сервис health сознательно не считают
 * ошибкой: если сам запрос не отвечает, баннер просто не показывается (`14_SCREENS.md` §0.4
 * трактует его как диагностику, а не как ещё один экран с состоянием ошибки).
 */
export function useHealth(): HealthState {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const timer = useRef<number | null>(null);

  const poll = useCallback(() => {
    void getHealth().then(setHealth, () => {
      // Health сам недоступен — секция деградации молчит, а не заменяется ошибкой поверх шапки.
    });
  }, []);

  useEffect(() => {
    poll();
    timer.current = window.setInterval(poll, POLL_MS);
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
      }
    };
  }, [poll]);

  return { health, refresh: poll };
}
