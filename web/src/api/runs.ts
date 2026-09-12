import type {
  OutageInterval,
  Run,
  RunCreateRequest,
  RunMetrics,
  RunTimeline,
  Snapshot,
} from './types';
import { apiPost, apiRequest } from './client';

/** `GET /api/runs/{id}` — статус, стадия, прогресс, ошибка завершившегося запуска. */
export function getRun(runId: string): Promise<Run> {
  return apiRequest<Run>(`/api/runs/${runId}`);
}

/** `GET /api/runs/{id}/metrics` — ClientMetrics[] и ConfigMetrics. */
export function getRunMetrics(runId: string): Promise<RunMetrics> {
  return apiRequest<RunMetrics>(`/api/runs/${runId}/metrics`);
}

/** `GET /api/runs/{id}/timeline` — доступность по клиентам битовыми масками. */
export function getRunTimeline(runId: string): Promise<RunTimeline> {
  return apiRequest<RunTimeline>(`/api/runs/${runId}/timeline`);
}

/** `GET /api/runs/{id}/outages` — перерывы связи по клиентам. */
export function getRunOutages(runId: string): Promise<OutageInterval[]> {
  return apiRequest<OutageInterval[]>(`/api/runs/${runId}/outages`);
}

/** `GET /api/runs/{id}/snapshot?t_s=` — состояние сети и маршруты клиентов на отсчёте. */
export function getRunSnapshot(runId: string, tS: number): Promise<Snapshot> {
  return apiRequest<Snapshot>(`/api/runs/${runId}/snapshot?t_s=${String(tS)}`);
}

/**
 * `POST /api/runs` — запуск суток. Ответ 202 — новый Run, 200 — переиспользованный по
 * `config_hash + engine_version` (ADR-011); тело у обоих одно, поэтому различать их
 * экрану незачем.
 */
export function createRun(payload: RunCreateRequest): Promise<Run> {
  return apiPost<Run>('/api/runs', payload);
}

/** Путь выгрузки результата `cosmo-A-result-1.0`. */
export function runExportPath(runId: string): string {
  return `/api/runs/${runId}/export`;
}

/** Путь архива Evidence Pack. */
export function runEvidencePackPath(runId: string): string {
  return `/api/runs/${runId}/evidence-pack`;
}
