import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ProjectSelectionContext } from './project-selection';
import type { ProjectSelection, ProjectSelectionValue } from './project-selection';
import { restoreSelection, storeSelection } from './selection-storage';

export function ProjectSelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<ProjectSelection>(restoreSelection);

  // Экраны вызывают сеттер из эффекта на каждой загрузке данных, поэтому одинаковый
  // выбор не должен приводить к перерисовке: иначе шапка мигает на каждом опросе Run.
  const select = useCallback((next: ProjectSelection) => {
    setSelection((current) =>
      current.projectId === next.projectId &&
      current.variantId === next.variantId &&
      current.runId === next.runId
        ? current
        : next,
    );
  }, []);

  // Выбор переживает перезагрузку: после F5 меню должно вести в разделы того же проекта,
  // который открыт на экране, а не снова требовать его выбрать.
  useEffect(() => {
    storeSelection(selection);
  }, [selection]);

  const value = useMemo<ProjectSelectionValue>(() => ({ selection, select }), [selection, select]);

  return (
    <ProjectSelectionContext.Provider value={value}>{children}</ProjectSelectionContext.Provider>
  );
}
