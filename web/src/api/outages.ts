import { apiRequest, jsonBody } from './client';
import type { ComparisonResult, CriticalityReport, OutageInterval } from './types';

/** Запросы экрана «Отказы»: перерывы с доказательствами, сравнение «до/после», X-Ray. */
export const outagesApi = {
  /** `GET /api/runs/{id}/outages` — OutageInterval[] с доказательствами причины. */
  getOutages: (runId: string): Promise<OutageInterval[]> =>
    apiRequest<OutageInterval[]>(`/api/runs/${encodeURIComponent(runId)}/outages`),

  /**
   * `POST /api/comparisons`. Первый запуск списка — база; у неё `deltas` и `per_client`
   * пустые, поэтому экран читает второй элемент `entries`.
   */
  compare: (runIds: readonly string[]): Promise<ComparisonResult> =>
    apiRequest<ComparisonResult>('/api/comparisons', jsonBody({ run_ids: runIds })),

  /**
   * `POST /api/analysis/criticality`. Сервис выполняет контрфактический прогон
   * по каждому спутнику и возвращает ранжированный отчёт об устойчивости.
   */
  criticality: (runId: string): Promise<CriticalityReport> =>
    apiRequest<CriticalityReport>('/api/analysis/criticality', jsonBody({ run_id: runId })),
};
