import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { ProjectContext } from './project-context';
import type { ProjectContextValue, ProjectSelection } from './project-context';

const EMPTY: ProjectSelection = { projectId: null, variantId: null, runId: null };

export function ProjectContextProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProjectSelection>(EMPTY);

  const select = useCallback((next: Partial<ProjectSelection>) => {
    setState((current) => {
      const projectId = next.projectId === undefined ? current.projectId : next.projectId;
      // Смена проекта обнуляет вариант и расчёт: чужой run на новом проекте — не данные,
      // а ошибка 404 через секунду.
      const switched = projectId !== current.projectId;
      const merged: ProjectSelection = {
        projectId,
        variantId:
          next.variantId === undefined ? (switched ? null : current.variantId) : next.variantId,
        runId: next.runId === undefined ? (switched ? null : current.runId) : next.runId,
      };
      const same =
        merged.projectId === current.projectId &&
        merged.variantId === current.variantId &&
        merged.runId === current.runId;
      return same ? current : merged;
    });
  }, []);

  const value = useMemo<ProjectContextValue>(() => ({ ...state, select }), [state, select]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
