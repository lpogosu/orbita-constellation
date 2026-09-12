import { apiPost, apiRequest } from './client';
import { runEvidencePackPath } from './runs';
import type { ComparisonResult, Recommendation } from './types';

/**
 * `POST /api/comparisons` — метрики запусков рядом, дельты и изменённые параметры.
 * Первый идентификатор списка сервис считает базой (`05_API.md` §1).
 */
export function compareRuns(runIds: readonly string[]): Promise<ComparisonResult> {
  return apiPost<ComparisonResult>('/api/comparisons', { run_ids: [...runIds] });
}

/** `GET /api/runs/{id}/recommendation?base_run_id=` — вывод из ранжирования ADR-006. */
export function getRecommendation(runId: string, baseRunId: string): Promise<Recommendation> {
  return apiRequest<Recommendation>(
    `/api/runs/${runId}/recommendation?base_run_id=${baseRunId}`,
  );
}

/**
 * Путь Evidence Pack со сравнением: без `base_run_id` архив собирается без сравнения и
 * вывода (`05_API.md` §2), а на экране сравнения нужен именно он.
 */
export function comparisonEvidencePackPath(runId: string, baseRunId: string): string {
  return `${runEvidencePackPath(runId)}?base_run_id=${baseRunId}`;
}
