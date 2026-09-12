import { AlertCircle, ArrowRight, Check, ChevronRight, Clock, Repeat, Share2 } from 'lucide-react';
import type { ReactNode } from 'react';

import type {
  BackupPaths,
  ClientRoute,
  GroundSite,
  OutageInterval,
  RunMetrics,
  Snapshot,
} from '@/api/types';
import { EmptyState, ErrorBlock, Skeleton, UnavailableBlock } from '@/components/state/States';
import { cx } from '@/lib/cx';
import type { ComponentSplit } from '@/map/model';
import { causeView, formatGap, formatTick } from '@/lib/run-format';

interface NetworkStateCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tS: number;
  readonly stale: boolean;
  readonly clients: readonly GroundSite[];
  readonly snapshot: Snapshot | null;
  readonly snapshotError: string | null;
  readonly metrics: RunMetrics | null;
  readonly outages: readonly OutageInterval[] | null;
  readonly resultsError: string | null;
  readonly onReloadResults: () => void;
  readonly runReady: boolean;
  readonly targetAvailability: number;
  readonly selectedClientId: string | null;
  readonly onSelectClient: (clientId: string) => void;
  readonly onSeek: (tS: number) => void;
  /** Компоненты связности на текущем отсчёте: `null` — клиенту не видно ни одного аппарата. */
  readonly componentSplit: ComponentSplit | null;
  readonly componentsShown: boolean;
  readonly onToggleComponents: () => void;
  readonly backup: BackupPaths | null;
  readonly backupError: string | null;
  readonly onLoadBackup: () => void;
}

/** Правая панель экрана «Сеть» (`14_SCREENS.md` §2.3), узел макета `37:331`. */
export function NetworkStateCard(props: NetworkStateCardProps) {
  const routeByClient = new Map<string, ClientRoute>(
    (props.snapshot?.clients ?? []).map((route) => [route.client_id, route]),
  );
  const metricsByClient = new Map(
    (props.metrics?.clients ?? []).map((item) => [item.client_id, item]),
  );

  const selected = props.selectedClientId;
  const selectedRoute = selected === null ? undefined : routeByClient.get(selected);
  const clientOutages =
    selected === null || props.outages === null
      ? []
      : props.outages.filter((outage) => outage.client_id === selected);
  const currentOutage = clientOutages.find(
    (outage) => props.tS >= outage.start_s && props.tS < outage.end_s,
  );

  return (
    <div
      className="card-glass absolute flex flex-col px-[23px] pb-[18px] pt-[16px]"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        backgroundPosition: `0 0, ${-props.x}px ${-props.y}px`,
      }}
    >
      <div className="flex items-center gap-[12px]">
        <h2 className="text-title-m font-semibold text-ink-primary" data-numeric>
          Момент {formatTick(props.tS)}
        </h2>
        {props.stale && (
          <span className="flex items-center gap-[6px] rounded-pill border border-[rgba(255,160,92,0.45)] bg-[rgba(255,160,92,0.16)] px-[12px] py-[5px] text-caption font-semibold text-status-warning">
            <AlertCircle aria-hidden="true" className="size-[13px]" />
            Результаты устарели
          </span>
        )}
      </div>
      {props.stale && (
        <p className="mt-[6px] text-caption text-ink-secondary">
          Параметры изменены — карта показывает предпросмотр черновика, а доступность за сутки
          относится к сохранённому варианту.
        </p>
      )}

      <div className="scroll-area mt-[14px] min-h-0 flex-1 pr-[6px]">
        <p className="text-micro font-semibold uppercase tracking-[0.88px] text-ink-muted">
          Клиенты · {props.clients.length}
        </p>

        {props.snapshotError !== null && props.snapshot === null ? (
          <div className="mt-[10px] h-[160px] rounded-sm border border-line-subtle bg-surface-sunken">
            <ErrorBlock
              title="Снимок не получен"
              message={props.snapshotError}
              onRetry={props.onReloadResults}
            />
          </div>
        ) : props.snapshot === null ? (
          <ul className="mt-[10px] space-y-[6px]">
            {props.clients.map((client) => (
              <li key={client.id}>
                <Skeleton className="h-[46px] w-full" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-[10px] space-y-[6px]">
            {props.clients.map((client) => {
              const route = routeByClient.get(client.id);
              const clientMetrics = metricsByClient.get(client.id);
              const active = client.id === selected;
              return (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => { props.onSelectClient(client.id); }}
                    aria-pressed={active}
                    className={cx(
                      'flex h-[46px] w-full items-center rounded-sm border px-[13px] text-left transition-colors duration-150',
                      active
                        ? 'border-[rgba(145,132,255,0.7)] bg-surface-rowActive'
                        : 'border-line-subtle bg-surface-sunken hover:border-line',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-[9px] rounded-pill"
                      style={{
                        background:
                          route?.reachable === true ? 'var(--chart-ok)' : 'var(--chart-no-client)',
                      }}
                    />
                    <span
                      title={client.id}
                      className="ml-[9px] w-[56px] shrink-0 truncate text-small font-semibold text-ink-primary"
                    >
                      {client.id}
                    </span>
                    <span
                      className="w-[82px] shrink-0 text-small font-semibold text-ink-primary"
                      data-numeric
                    >
                      {clientMetrics === undefined
                        ? '—'
                        : `${(clientMetrics.availability * 100).toFixed(2)} %`}
                    </span>
                    {clientMetrics !== undefined &&
                      (clientMetrics.target_met ? (
                        <Check aria-hidden="true" className="size-[13px] text-status-success" />
                      ) : (
                        <AlertCircle aria-hidden="true" className="size-[13px] text-status-warning" />
                      ))}
                    <span
                      title={
                        route === undefined || route.reachable
                          ? undefined
                          : causeView(route.primary_cause ?? 'INTERNAL_INCONSISTENCY').full
                      }
                      className={cx(
                        'ml-[8px] min-w-0 flex-1 truncate text-caption font-medium',
                        route?.reachable === true ? 'text-status-success' : 'text-status-danger',
                      )}
                    >
                      {route === undefined
                        ? '—'
                        : route.reachable
                          ? 'связь есть'
                          : causeView(route.primary_cause ?? 'INTERNAL_INCONSISTENCY').full}
                    </span>
                    <span className="shrink-0 text-caption text-ink-muted" data-numeric>
                      {route?.hops ?? '—'} пер.
                    </span>
                    <ChevronRight aria-hidden="true" className="ml-[8px] size-[15px] text-ink-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected !== null && selectedRoute !== undefined && (
          <>
            <p className="mt-[18px] text-micro font-semibold uppercase tracking-[0.88px] text-ink-muted">
              Маршрут {selected} · {formatTick(props.tS)}
            </p>

            <div className="mt-[10px] grid grid-cols-3 gap-[7px]">
              <Metric
                icon={<Share2 aria-hidden="true" className="size-[14px] text-ink-secondary" />}
                value={selectedRoute.hops === null ? '—' : String(selectedRoute.hops)}
                caption="переходов"
              />
              <Metric
                icon={<ArrowRight aria-hidden="true" className="size-[14px] text-ink-secondary" />}
                value={
                  props.snapshot === null
                    ? '—'
                    : `${Math.round(pathLengthKm(props.snapshot, selectedRoute.path)).toLocaleString('ru-RU')} км`
                }
                caption="длина"
              />
              <Metric
                icon={<Repeat aria-hidden="true" className="size-[14px] text-ink-secondary" />}
                value={String(metricsByClient.get(selected)?.route_switches ?? '—')}
                caption="перестроений"
              />
            </div>

            {selectedRoute.path.length > 0 && (
              <ol className="mt-[12px] flex flex-wrap items-center gap-[4px]">
                {selectedRoute.path.map((node, index) => (
                  <li key={node} className="flex items-center gap-[4px]">
                    {index > 0 && <span className="text-micro text-ink-muted">→</span>}
                    <span className="rounded-pill border border-line-subtle bg-surface-raised px-[9px] py-[6px] text-caption font-semibold text-ink-primary">
                      {node}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <button
              type="button"
              onClick={props.onLoadBackup}
              disabled={!props.runReady}
              className="mt-[12px] flex h-[46px] w-full items-center rounded-sm border border-line-subtle bg-surface-sunken px-[11px] text-left disabled:opacity-45"
              title={props.runReady ? undefined : 'Нужен завершённый расчёт'}
            >
              <Repeat aria-hidden="true" className="size-[14px] text-ink-secondary" />
              <span
                title={
                  props.backup === null ? undefined : (props.backup.paths[1] ?? []).join(' → ')
                }
                className="ml-[10px] min-w-0 flex-1 truncate text-caption text-ink-secondary"
              >
                {props.backup === null
                  ? 'Резервный маршрут'
                  : props.backup.paths.length < 2
                    ? 'Резервного маршрута нет'
                    : `Резервный: ${(props.backup.paths[1] ?? []).join(' → ')}`}
              </span>
              {props.backup !== null && (
                <span className="ml-[8px] shrink-0 text-micro text-ink-muted" data-numeric>
                  непересекающихся: {props.backup.backup_path_count}
                </span>
              )}
            </button>
            {props.backupError !== null && (
              <p role="alert" className="mt-[6px] text-caption text-status-danger">
                {props.backupError}
              </p>
            )}

            {clientOutages.length > 0 && (
              <button
                type="button"
                onClick={() => { props.onSeek(clientOutages[0]?.start_s ?? 0); }}
                className="mt-[12px] text-caption font-semibold text-accent-blue"
              >
                Перейти к первому перерыву · {formatTick(clientOutages[0]?.start_s ?? 0)} ›
              </button>
            )}

            {currentOutage !== undefined && (
              <CauseBlock
                outage={currentOutage}
                split={props.componentSplit}
                shown={props.componentsShown}
                onToggle={props.onToggleComponents}
              />
            )}
          </>
        )}

        <p className="mt-[18px] text-micro font-semibold uppercase tracking-[0.88px] text-ink-muted">
          Сводка конфигурации
        </p>
        {props.resultsError !== null ? (
          <div className="mt-[10px] h-[140px] rounded-sm border border-line-subtle bg-surface-sunken">
            <ErrorBlock
              title="Метрики не получены"
              message={props.resultsError}
              onRetry={props.onReloadResults}
              compact
            />
          </div>
        ) : !props.runReady ? (
          <div className="mt-[10px] h-[140px] rounded-sm border border-line-subtle bg-surface-sunken">
            <UnavailableBlock
              title="Нужен завершённый расчёт"
              hint="Доступность за сутки, худший перерыв и число перестроений появляются после «Запустить расчёт»."
              compact
            />
          </div>
        ) : props.metrics === null ? (
          <Skeleton className="mt-[10px] h-[140px] w-full" />
        ) : (
          <dl className="mt-[10px] grid grid-cols-2 gap-[7px]">
            <Summary
              term="Худшая доступность"
              value={`${(props.metrics.config.min_client_availability * 100).toFixed(2)} %`}
            />
            <Summary term="Худший перерыв" value={formatGap(props.metrics.config.worst_max_gap_s)} />
            <Summary
              term="Перестроений маршрутов"
              value={String(props.metrics.config.route_switches_total)}
            />
            <Summary
              term="Цель достигнута"
              value={`${props.metrics.config.target_met_clients.length} из ${props.metrics.clients.length} · цель ${(props.targetAvailability * 100).toFixed(0)} %`}
            />
          </dl>
        )}

        {props.runReady && props.metrics !== null && props.metrics.clients.length === 0 && (
          <EmptyState
            title="Метрик нет"
            hint="Расчёт завершился, но клиентских пунктов в сценарии не оказалось."
          />
        )}
      </div>
    </div>
  );
}

function CauseBlock({
  outage,
  split,
  shown,
  onToggle,
}: {
  outage: OutageInterval;
  split: ComponentSplit | null;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-[14px] rounded-[14px] border border-[rgba(255,92,110,0.38)] bg-[rgba(255,92,110,0.12)] px-[13px] py-[11px]">
      <p className="flex items-center gap-[9px] text-small font-semibold text-status-danger" data-numeric>
        <AlertCircle aria-hidden="true" className="size-[16px]" />
        {outage.client_id} · нет пути {formatTick(outage.start_s)} – {formatTick(outage.end_s)}
      </p>
      <p className="mt-[8px] text-caption font-medium text-ink-secondary">
        Причина: {causeView(outage.primary_cause).full}
        {outage.truncated_by_horizon && ' · перерыв обрезан границей расчёта'}
      </p>
      <ul className="mt-[8px] space-y-[5px] text-caption text-ink-muted">
        <li>Клиенту видны: {listOrDash(outage.client_visible_satellites)}</li>
        <li>Шлюзу видны: {listOrDash(outage.gateway_visible_satellites)}</li>
        <li>В отказе: {listOrDash(outage.failed_satellites)}</li>
        <li className="flex items-center gap-[6px]">
          <Clock aria-hidden="true" className="size-[12px]" />
          Последний маршрут: {listOrDash(outage.last_path)} · следующий: {listOrDash(outage.next_path)}
        </li>
      </ul>
      {split === null ? (
        <p className="mt-[10px] text-caption text-ink-muted">
          у клиента нет видимых спутников на этом отсчёте
        </p>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={shown}
          className="mt-[10px] text-caption font-semibold text-accent-blue"
        >
          {shown ? 'Скрыть компоненты' : 'Показать компоненты'} ›
        </button>
      )}
    </div>
  );
}

function Metric({ icon, value, caption }: { icon: ReactNode; value: string; caption: string }) {
  return (
    <div className="h-[48px] rounded-sm border border-line-subtle bg-surface-sunken px-[11px] pt-[5px]">
      <p className="flex items-center gap-[8px] text-small font-semibold text-ink-primary" data-numeric>
        {icon}
        {value}
      </p>
      <p className="text-micro text-ink-muted">{caption}</p>
    </div>
  );
}

function Summary({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-sm border border-line-subtle bg-surface-sunken px-[11px] py-[8px]">
      <dt className="text-micro text-ink-muted">{term}</dt>
      <dd className="text-small font-semibold text-ink-primary" data-numeric>
        {value}
      </dd>
    </div>
  );
}

function listOrDash(items: readonly string[]): string {
  return items.length === 0 ? '—' : items.join(', ');
}

/**
 * Длина маршрута — сумма `distance_km` тех же рёбер снимка, из которых он собран.
 * Отдельного поля в API нет; складываются числа, которые сервис уже вернул.
 */
function pathLengthKm(snapshot: Snapshot, path: readonly string[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    const edge = snapshot.edges.find(
      (item) => (item.a === a && item.b === b) || (item.a === b && item.b === a),
    );
    total += edge?.distance_km ?? 0;
  }
  return total;
}
