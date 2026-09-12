import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { EMPTY_SELECTION, ProjectSelectionContext } from './project-selection';
import type { ProjectSelection, ProjectSelectionValue } from './project-selection';

export function ProjectSelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<ProjectSelection>(EMPTY_SELECTION);

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

  const value = useMemo<ProjectSelectionValue>(() => ({ selection, select }), [selection, select]);

  return (
    <ProjectSelectionContext.Provider value={value}>{children}</ProjectSelectionContext.Provider>
  );
}
