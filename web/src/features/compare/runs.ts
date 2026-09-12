import type { ProjectDetail, Run, RoutingPolicy, Variant } from '@/api/types';

/** Вариант проекта вместе с его завершёнными запусками, новые впереди. */
export interface VariantRuns {
  readonly variant: Variant;
  readonly runs: readonly Run[];
}

/**
 * `GET /api/projects/{id}` отдаёт варианты и последние запуски отдельными списками, а
 * экран выбирает вариант вместе с запуском: сравнивать можно только посчитанное.
 */
export function groupRuns(detail: ProjectDetail): VariantRuns[] {
  const finished = detail.recent_runs
    .filter((run) => run.status === 'succeeded')
    .sort(byFinishedDesc);

  return detail.variants.map((variant) => ({
    variant,
    runs: finished.filter((run) => run.variant_id === variant.id),
  }));
}

/** Запуск варианта под нужной политикой; без политики — самый свежий. */
export function pickRun(group: VariantRuns, policy?: RoutingPolicy): Run | undefined {
  return policy === undefined
    ? group.runs[0]
    : group.runs.find((run) => run.routing_policy === policy);
}

export function findRun(groups: readonly VariantRuns[], runId: string): Run | undefined {
  for (const group of groups) {
    const run = group.runs.find((item) => item.id === runId);
    if (run !== undefined) {
      return run;
    }
  }
  return undefined;
}

export function variantOfRun(groups: readonly VariantRuns[], runId: string): Variant | undefined {
  return groups.find((group) => group.runs.some((run) => run.id === runId))?.variant;
}

/**
 * Пара вариантов для первого показа: два самых свежих расчёта разных вариантов. Экран
 * открывают из списка проектов без параметров, и пустое сравнение вместо готового
 * заставило бы собирать его вручную каждый раз.
 */
export function defaultRunIds(groups: readonly VariantRuns[]): string[] {
  const latest = groups
    .map((group) => group.runs[0])
    .filter((run): run is Run => run !== undefined)
    .sort(byFinishedDesc);
  return latest.slice(0, 2).map((run) => run.id);
}

/** Запуски одного варианта под разными политиками — режим «Политики». */
export function policyRuns(group: VariantRuns): Run[] {
  const seen = new Set<RoutingPolicy>();
  const result: Run[] = [];
  for (const run of group.runs) {
    if (!seen.has(run.routing_policy)) {
      seen.add(run.routing_policy);
      result.push(run);
    }
  }
  return result;
}

function byFinishedDesc(left: Run, right: Run): number {
  return moment(right.finished_at) - moment(left.finished_at);
}

function moment(iso: string | null | undefined): number {
  return iso === null || iso === undefined ? 0 : Date.parse(iso);
}
