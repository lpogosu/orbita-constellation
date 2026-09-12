import { jsonBody, request, requestBlob } from './client';
import type {
  ComparisonResult,
  ProjectDetail,
  Recommendation,
  Run,
  RunCreateRequest,
  RunTimeline,
} from './types';

/** Запросы экрана «05 · Сравнение вариантов» (`05_API.md` §2). */
export const comparisonsApi = {
  /** `GET /api/projects/{id}` — варианты проекта и его последние запуски. */
  getProject: (projectId: string): Promise<ProjectDetail> =>
    request<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),

  /** `POST /api/comparisons` — первый запуск списка считается базой. */
  compare: (runIds: readonly string[]): Promise<ComparisonResult> =>
    request<ComparisonResult>('/api/comparisons', jsonBody({ run_ids: [...runIds] })),

  /** `GET /api/runs/{id}/recommendation?base_run_id=` — вывод из ранжирования ADR-006. */
  recommendation: (runId: string, baseRunId: string): Promise<Recommendation> =>
    request<Recommendation>(
      `/api/runs/${encodeURIComponent(runId)}/recommendation?base_run_id=${encodeURIComponent(baseRunId)}`,
    ),

  /** `GET /api/runs/{id}/timeline` — доступность по отсчётам, упакованная битами. */
  timeline: (runId: string): Promise<RunTimeline> =>
    request<RunTimeline>(`/api/runs/${encodeURIComponent(runId)}/timeline`),

  /** `POST /api/runs` — расчёт варианта под выбранной политикой маршрутизации. */
  createRun: (payload: RunCreateRequest): Promise<Run> =>
    request<Run>('/api/runs', jsonBody(payload)),

  /** `GET /api/runs/{id}/evidence-pack?base_run_id=` — zip с экспортом, сравнением и выводом. */
  evidencePack: (runId: string, baseRunId: string): Promise<Blob> =>
    requestBlob(
      `/api/runs/${encodeURIComponent(runId)}/evidence-pack?base_run_id=${encodeURIComponent(baseRunId)}`,
    ),
};
