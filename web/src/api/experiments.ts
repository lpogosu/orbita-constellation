import { ApiError, jsonBody, request } from './client';
import type { Experiment, ExperimentCreateRequest, ExperimentPoint, Variant } from './types';

/**
 * Запросы экрана «07 · Исследования» (`05_API.md` §2).
 *
 * Все четыре endpoint объявлены в OpenAPI, но сейчас отвечают 501 `NOT_IMPLEMENTED`:
 * расчёт перебора появится позже. Экран вызывает их по-настоящему и показывает ответ
 * сервиса, а не подставляет данные вместо него.
 */
export const experimentsApi = {
  /** `POST /api/experiments` — поставить перебор по одной или двум осям. */
  create: (payload: ExperimentCreateRequest): Promise<Experiment> =>
    request<Experiment>('/api/experiments', jsonBody(payload)),

  /** `GET /api/experiments/{id}` — статус, прогресс и лучшие точки. */
  get: (experimentId: string): Promise<Experiment> =>
    request<Experiment>(`/api/experiments/${encodeURIComponent(experimentId)}`),

  /** `GET /api/experiments/{id}/points` — точки тепловой карты с метриками. */
  points: (experimentId: string): Promise<ExperimentPoint[]> =>
    request<ExperimentPoint[]>(`/api/experiments/${encodeURIComponent(experimentId)}/points`),

  /** `POST /api/experiments/{id}/points/{point_id}/materialize` — из точки в Variant. */
  materialize: (experimentId: string, pointId: string, title: string): Promise<Variant> =>
    request<Variant>(
      `/api/experiments/${encodeURIComponent(experimentId)}/points/${encodeURIComponent(pointId)}/materialize`,
      jsonBody({ title }),
    ),
};

/**
 * Отличает «сервис ещё не умеет» от «сервис сломался»: 501 — это объявленный, но не
 * реализованный endpoint, и блок результата обязан сказать об этом прямо, а не показать
 * общую ошибку.
 */
export function isNotImplemented(error: unknown): boolean {
  return error instanceof ApiError && error.status === 501;
}
