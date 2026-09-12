import { useCallback, useState } from 'react';

export type MapMode = '2d' | '3d';

const STORAGE_KEY = 'orbita.mapMode';

function readStored(): MapMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === '3d' ? '3d' : '2d';
  } catch {
    // Приватный режим браузера — экран остаётся на 2D, а не падает.
    return '2d';
  }
}

/**
 * Режим карты хранится в `localStorage` тем же способом, что `orbita.theme` и
 * `orbita.selection` (`app/selection-storage.ts`, `theme/use-theme.ts`): один ключ, простое
 * строковое значение, чтение и запись в `try/catch`. Общий на оба экрана («Сеть» и «Отказы»),
 * поэтому переключение на одном экране остаётся в силе и на другом.
 */
export function useMapMode(): readonly [MapMode, (mode: MapMode) => void] {
  const [mode, setMode] = useState<MapMode>(readStored);

  const change = useCallback((next: MapMode) => {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Значение не сохранится между перезагрузками, но экран продолжает работать.
    }
  }, []);

  return [mode, change] as const;
}
