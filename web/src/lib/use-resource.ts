import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  /** `null`, пока идёт загрузка: блок в это время показывает скелетон. */
  readonly data: T | null;
  readonly error: string | null;
  readonly reload: () => void;
}

/**
 * Однократная загрузка с повтором по кнопке. Ответ на устаревший запрос отбрасывается:
 * повторная загрузка не должна проиграть гонку своей же предыдущей попытке.
 */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({
    data: null,
    error: null,
  });
  const attempt = useRef(0);

  const reload = useCallback(() => {
    const current = ++attempt.current;
    setState({ data: null, error: null });
    void load().then(
      (data) => {
        if (attempt.current === current) {
          setState({ data, error: null });
        }
      },
      (error: unknown) => {
        if (attempt.current === current) {
          setState({ data: null, error: describe(error) });
        }
      },
    );
  }, [load]);

  useEffect(reload, [reload]);

  return { data: state.data, error: state.error, reload };
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}
