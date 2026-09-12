import type { LineageGraph, ProjectDetail, RunMetrics, Variant } from './types';
import { apiRequest } from './client';
import { getRunMetrics } from './runs';

/** `GET /api/projects/{id}` — проект, его варианты и последние запуски одним ответом. */
export function getProject(projectId: string): Promise<ProjectDetail> {
  return apiRequest<ProjectDetail>(`/api/projects/${projectId}`);
}

/** `GET /api/projects/{id}/lineage` — узлы вариантов и рёбра с diff от родителя. */
export function getProjectLineage(projectId: string): Promise<LineageGraph> {
  return apiRequest<LineageGraph>(`/api/projects/${projectId}/lineage`);
}

/** `GET /api/variants/{id}` — вариант со сценарием и diff от родителя. */
export function getVariant(variantId: string): Promise<Variant> {
  return apiRequest<Variant>(`/api/variants/${variantId}`);
}

/** Путь выгрузки effective scenario варианта. */
export function variantExportPath(variantId: string): string {
  return `/api/variants/${variantId}/export`;
}

/** Проект, его происхождение и метрики завершённых запусков — всё, чем живёт экран. */
export interface ProjectBoard {
  readonly detail: ProjectDetail;
  readonly lineage: LineageGraph;
  /** Метрики по `run_id`; запуск без метрик в карте отсутствует. */
  readonly metricsByRun: ReadonlyMap<string, RunMetrics>;
}

export async function getProjectBoard(projectId: string): Promise<ProjectBoard> {
  const [detail, lineage] = await Promise.all([
    getProject(projectId),
    getProjectLineage(projectId),
  ]);

  // Худшей доступности нет ни в `Run`, ни в узлах lineage, а колонка «min дост.» есть в
  // обеих таблицах макета. Единственный источник — метрики каждого запуска; их берём
  // параллельно и не роняем экран, если какая-то пара не отдалась: строка покажет прочерк.
  const succeeded = detail.recent_runs.filter((run) => run.status === 'succeeded');
  const metrics = await Promise.all(
    succeeded.map((run) => getRunMetrics(run.id).catch(() => null)),
  );

  const metricsByRun = new Map<string, RunMetrics>();
  succeeded.forEach((run, index) => {
    const entry = metrics[index];
    if (entry != null) {
      metricsByRun.set(run.id, entry);
    }
  });

  return { detail, lineage, metricsByRun };
}
