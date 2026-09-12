import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'orbita.theme';
/** Макет нарисован тёмным: это основное состояние интерфейса, а не предпочтение системы. */
const DEFAULT_THEME: Theme = 'dark';

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Приватный режим запрещает запись: тема останется выбранной до перезагрузки.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch {
    // Чтение недоступно — остаётся тема по умолчанию.
  }
  return DEFAULT_THEME;
}
