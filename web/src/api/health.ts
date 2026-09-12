import type { HealthResponse } from './types';
import { apiRequest } from './client';

/** `GET /api/health` — состояние хранилищ и признак `degraded_mode` (`06_STORAGE.md` §7). */
export function getHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/health');
}
