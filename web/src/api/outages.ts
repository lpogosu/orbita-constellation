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
   * `POST /api/analysis/criticality`. Реализации пока нет: endpoint отвечает 501
   * `NOT_IMPLEMENTED`. Кнопка блока вызывает его по-настоящему, а ошибка показывается как
   * состояние «не подключено» — выдуманных рангов на экране нет.
   */
  criticality: (runId: string): Promise<CriticalityReport> =>
    apiRequest<CriticalityReport>('/api/analysis/criticality', jsonBody({ run_id: runId })),
};
