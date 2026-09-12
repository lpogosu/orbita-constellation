import { createContext, useContext } from 'react';

/**
 * Текущий контекст работы: проект, его вариант и последний расчёт этого варианта. Экраны
 * «Сеть» и «Отказы» живут в одном контексте, поэтому переход между ними не теряет ни
 * вариант, ни расчёт (`14_SCREENS.md` §0.1).
 *
 * Значения держатся в памяти вкладки: они относятся к текущему сеансу работы, а ссылка на
 * конкретный отсчёт передаётся через query экрана.
 */
export interface ProjectSelection {
  readonly projectId: string | null;
  readonly variantId: string | null;
  readonly runId: string | null;
}

export interface ProjectContextValue extends ProjectSelection {
  readonly select: (next: Partial<ProjectSelection>) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (value === null) {
    throw new Error('useProjectContext вызван вне ProjectContextProvider');
  }
  return value;
}
