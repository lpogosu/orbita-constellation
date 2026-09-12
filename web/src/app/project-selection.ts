import { createContext, useContext } from 'react';

/**
 * Что открыто прямо сейчас. Контекст держит только идентификаторы: названия проекта и
 * варианта грузит тот, кому они нужны, и ни один экран не обязан класть сюда свои данные,
 * чтобы шапка их увидела.
 */
export interface ProjectSelection {
  readonly projectId: string | null;
  readonly variantId: string | null;
  readonly runId: string | null;
}

export const EMPTY_SELECTION: ProjectSelection = {
  projectId: null,
  variantId: null,
  runId: null,
};

export interface ProjectSelectionValue {
  readonly selection: ProjectSelection;
  readonly select: (next: ProjectSelection) => void;
}

export const ProjectSelectionContext = createContext<ProjectSelectionValue | null>(null);

export function useProjectSelection(): ProjectSelectionValue {
  const value = useContext(ProjectSelectionContext);
  if (value === null) {
    throw new Error('useProjectSelection вызван вне ProjectSelectionProvider');
  }
  return value;
}
