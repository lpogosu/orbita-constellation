import { useCallback, useState } from 'react';

export type MapMode = '2d' | '3d';

// Новая версия ключа намеренно не наследует старое значение «2d»: до появления
// полноценного глобуса это было дефолтом, теперь первым открывается более понятный 3D.
const STORAGE_KEY = 'orbita.mapMode.v2';

function readStored(): MapMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === '2d' ? '2d' : '3d';
  } catch {
    // Приватный режим браузера — экран всё равно начинает с полезного 3D-вида.
    return '3d';
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
