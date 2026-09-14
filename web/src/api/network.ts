import { DEMO_MODE } from '@/demo/mode';
import { apiRequest, jsonBody } from './client';
import type {
  BackupPaths,
  ProjectDetail,
  Run,
  RunMetrics,
  RunProgressEvent,
  RunTimeline,
  RoutingPolicy,
  Scenario,
  Snapshot,
  Variant,
  VariantCreateRequest,
} from './types';

/** Запросы экрана «Сеть» (`05_API.md` §2): конфигурация, предпросмотр, расчёт, снимок. */
export const networkApi = {
  /** `GET /api/projects/{id}` — проект, его варианты и последние запуски. */
  getProject: (projectId: string): Promise<ProjectDetail> =>
    apiRequest<ProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`),

  /** `GET /api/variants/{id}` — вариант со сценарием и diff от родителя. */
  getVariant: (variantId: string): Promise<Variant> =>
    apiRequest<Variant>(`/api/variants/${encodeURIComponent(variantId)}`),

  /** `POST /api/projects/{id}/variants` — черновик становится сохранённым вариантом. */
  createVariant: (projectId: string, payload: VariantCreateRequest): Promise<Variant> =>
    apiRequest<Variant>(`/api/projects/${encodeURIComponent(projectId)}/variants`, jsonBody(payload)),

  /** `POST /api/preview` — один отсчёт черновика без варианта и без запуска. */
  preview: (scenario: Scenario, tS: number, routingPolicy: RoutingPolicy): Promise<Snapshot> =>
    apiRequest<Snapshot>(
      '/api/preview',
      jsonBody({ scenario, t_s: tS, routing_policy: routingPolicy }),
    ),

  /**
   * `POST /api/runs`. Ключ идемпотентности обязателен: без него повторное нажатие
   * «Запустить расчёт» (или перерисовка React в строгом режиме) поставило бы второй
   * запуск той же конфигурации.
   */
  createRun: (
    variantId: string,
    routingPolicy: RoutingPolicy,
    idempotencyKey: string,
  ): Promise<Run> =>
    apiRequest<Run>(
      '/api/runs',
      jsonBody(
        { variant_id: variantId, routing_policy: routingPolicy },
        { 'Idempotency-Key': idempotencyKey },
      ),
    ),

  /** `GET /api/runs/{id}` — запасной путь к прогрессу, когда поток событий оборвался. */
  getRun: (runId: string): Promise<Run> =>
    apiRequest<Run>(`/api/runs/${encodeURIComponent(runId)}`),

  /** `POST /api/runs/{id}/cancel` — завершённый запуск отменить нельзя, это 409. */
  cancelRun: (runId: string): Promise<Run> =>
    apiRequest<Run>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),

  /** `GET /api/runs/{id}/snapshot?t_s=` — состояние сети на отсчёте. */
  getSnapshot: (runId: string, tS: number): Promise<Snapshot> =>
    apiRequest<Snapshot>(`/api/runs/${encodeURIComponent(runId)}/snapshot?t_s=${tS}`),

  /** `GET /api/runs/{id}/timeline` — bitset доступности и причины по отсчётам. */
  getTimeline: (runId: string): Promise<RunTimeline> =>
    apiRequest<RunTimeline>(`/api/runs/${encodeURIComponent(runId)}/timeline`),

  /** `GET /api/runs/{id}/metrics` — ClientMetrics[] и ConfigMetrics. */
  getMetrics: (runId: string): Promise<RunMetrics> =>
    apiRequest<RunMetrics>(`/api/runs/${encodeURIComponent(runId)}/metrics`),

  /** `GET /api/runs/{id}/backup-paths?t_s=&client_id=` — непересекающиеся пути и разрез. */
  getBackupPaths: (runId: string, tS: number, clientId: string): Promise<BackupPaths> =>
    apiRequest<BackupPaths>(
      `/api/runs/${encodeURIComponent(runId)}/backup-paths?t_s=${tS}&client_id=${encodeURIComponent(clientId)}`,
    ),
};

export interface RunEventsSubscription {
  readonly close: () => void;
}

/**
 * `GET /api/runs/{id}/events`. Сервер шлёт события с именем `progress`, в `data` —
 * `RunProgressEvent`. Поток закрывается сам, когда запуск дошёл до конечного статуса,
 * поэтому браузерный автореконнект `EventSource` отключается вручную: иначе он будет
 * бесконечно переоткрывать поток завершённого расчёта.
 */
export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunProgressEvent) => void,
  onError: (message: string) => void,
): RunEventsSubscription {
  if (DEMO_MODE) {
    // Статический сайт не держит поток событий, а все расчёты записи уже завершены. Поток
    // сразу считается закрытым: экран дочитает статус запросом, как при обрыве связи.
    const timer = window.setTimeout(() => {
      onError('Поток прогресса в демо не открывается — статус расчёта берётся из записи');
    }, 0);
    return {
      close: () => {
        window.clearTimeout(timer);
      },
    };
  }

  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  let closed = false;

  const close = (): void => {
    closed = true;
    source.close();
  };

  source.addEventListener('progress', (event) => {
    const payload: unknown = JSON.parse((event as MessageEvent<string>).data);
    const progress = payload as RunProgressEvent;
    onEvent(progress);
    if (progress.status !== 'queued' && progress.status !== 'running') {
      close();
    }
  });

  source.addEventListener('error', () => {
    if (closed) {
      return;
    }
    // `EventSource` не показывает код ответа; различить «сервис лёг» и «поток закрыт
    // штатно» можно только по состоянию, поэтому статус запуска добирается запросом.
    if (source.readyState === EventSource.CLOSED) {
      onError('Поток прогресса закрыт — статус расчёта обновляется запросом');
    }
  });

  return { close };
}
