import { useCallback, useEffect, useState } from 'react';

/**
 * Чтение токенов темы из CSS. Графики рисуются в canvas или SVG сами и классами Tailwind
 * покрашены быть не могут, поэтому цвет им приходится отдавать значением. Значение берётся
 * из тех же переменных, что и весь интерфейс, и пересчитывается при смене темы — иначе
 * после переключения график остаётся в цветах прошлой темы.
 */
export function useTokenColors(): (name: string) => string {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setRevision((current) => current + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  return useCallback(
    (name: string) => {
      // `revision` участвует в зависимостях намеренно: смена темы обязана дать новую
      // функцию, иначе `useMemo` графика посчитает настройки устаревшими и не обновит цвет.
      void revision;
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    },
    [revision],
  );
}
