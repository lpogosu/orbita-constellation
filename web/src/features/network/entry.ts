import { useRef } from 'react';

import type { SceneEntry } from './use-network-scene';

/**
 * Позиция, с которой открыт экран: `run` и `t` из адреса. Снимается один раз, при
 * монтировании: дальше те же параметры экран пишет сам, и перечитывание их вернуло бы
 * маркер шкалы назад при каждом шаге воспроизведения.
 */
export function useSceneEntry(search: URLSearchParams): SceneEntry {
  const entry = useRef<SceneEntry | null>(null);
  if (entry.current === null) {
    const raw = search.get('t');
    const seconds = raw === null ? Number.NaN : Number(raw);
    entry.current = {
      runId: search.get('run'),
      tS: Number.isFinite(seconds) && seconds >= 0 ? seconds : null,
    };
  }
  return entry.current;
}
