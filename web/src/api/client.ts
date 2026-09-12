import type {
  ErrorDetail,
  Project,
  ProjectCreateRequest,
  ScenarioValidationResult,
} from './types';

/**
 * Ошибка API в терминах конверта `05_API.md` §3. Валидация отвечает списком `errors[]`,
 * остальные endpoint — одиночным `error`; обе формы приводятся к одному списку, чтобы
 * экран показывал все причины сразу, а не первую.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: readonly ErrorDetail[];

  constructor(status: number, details: readonly ErrorDetail[], message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Сеть недоступна или ответ нечитаем: причина не в содержании запроса. */
export class TransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransportError';
  }
}

const UNKNOWN_ERROR_MESSAGE = 'Сервис вернул ответ, который не удалось разобрать';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');

  const response = await send(path, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw failure(response.status, body);
  }

  return body as T;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (cause) {
    throw new TransportError('Сервис недоступен: проверьте, что стек запущен', { cause });
  }
}

function failure(status: number, body: unknown): ApiError {
  const details = toErrorDetails(body);
  return new ApiError(
    status,
    details,
    details[0]?.message ?? `${UNKNOWN_ERROR_MESSAGE} (HTTP ${status})`,
  );
}

function toErrorDetails(body: unknown): readonly ErrorDetail[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const envelope = body as { errors?: unknown; error?: unknown };
  if (Array.isArray(envelope.errors)) {
    return envelope.errors as ErrorDetail[];
  }
  if (typeof envelope.error === 'object' && envelope.error !== null) {
    return [envelope.error as ErrorDetail];
  }
  return [];
}

/** POST с телом JSON: форма запроса одинакова у всех endpoint, кроме выгрузок. */
export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return apiRequest<T>(path, jsonBody(payload));
}

function jsonBody(payload: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

export const api = {
  /**
   * `POST /api/scenarios/validate` — сводка сценария без сохранения.
   *
   * На вход идёт разобранный, но ещё не проверенный документ: форму файла определяет
   * сервис, а не браузер, поэтому тип аргумента — `unknown`, а не `Scenario`.
   */
  validateScenario: (document: unknown): Promise<ScenarioValidationResult> =>
    apiRequest<ScenarioValidationResult>('/api/scenarios/validate', jsonBody(document)),

  /** `POST /api/projects` — проект создаётся сразу с первым вариантом. */
  createProject: (payload: ProjectCreateRequest): Promise<Project> =>
    apiRequest<Project>('/api/projects', jsonBody(payload)),

  /** `GET /api/projects` — проекты в порядке убывания даты создания. */
  listProjects: (): Promise<Project[]> => apiRequest<Project[]>('/api/projects'),
};
