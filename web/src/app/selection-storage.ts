import { EMPTY_SELECTION } from './project-selection';
import type { ProjectSelection } from './project-selection';

const STORAGE_KEY = 'orbita.selection';

/**
 * Что из выбора переживает перезагрузку. Идентификатор расчёта — нет: экран сети берёт
 * сохранённый `runId` как есть, и прошлосессионный расчёт подставился бы к чужому
 * проекту. Проект и вариант экраны сверяют со своими списками, поэтому они безопасны.
 */
interface StoredSelection {
  readonly projectId: string;
  readonly variantId: string | null;
}

export function restoreSelection(): ProjectSelection {
  const stored = read();
  if (stored === null) {
    return EMPTY_SELECTION;
  }
  return { projectId: stored.projectId, variantId: stored.variantId, runId: null };
}

export function storeSelection(selection: ProjectSelection): void {
  try {
    if (selection.projectId === null) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const stored: StoredSelection = {
      projectId: selection.projectId,
      variantId: selection.variantId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Хранилище может быть запрещено настройками браузера. Выбор тогда живёт до
    // перезагрузки — это хуже, чем с хранилищем, но не ломает ни один экран.
  }
}

function read(): StoredSelection | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Partial<Record<keyof StoredSelection, unknown>>;
  if (typeof record.projectId !== 'string' || record.projectId === '') {
    return null;
  }
  return {
    projectId: record.projectId,
    variantId: typeof record.variantId === 'string' ? record.variantId : null,
  };
}
