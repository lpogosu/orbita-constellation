import { ChevronRight, Share2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { ClientMetrics, Snapshot } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { NETWORK_PATH } from '@/app/sections';
import { cx } from '@/lib/cx';
import { DASH, causeView, formatShare, formatTick } from '@/lib/run-format';

const LEFT = 552;
const TOP = 570;

interface RouteCoverageCardProps {
  snapshot: Snapshot | null;
  clients: readonly ClientMetrics[] | null;
  meanHops: number | null;
  projectId: string | null;
  variantId: string | null;
  error: string | null;
  onRetry: () => void;
}

/**
 * Card / Route Coverage (50:699). Полноценная карта живёт на экране «Сеть», поэтому
 * здесь иллюстрация Земли из макета работает фоном, а поверх идут маршруты клиентов на
 * текущем отсчёте — текстом, из `GET /api/runs/{id}/snapshot`. Рисовать поверх картинки
 * «примерные» линии было бы враньём: координаты аппаратов в снимке есть, проекция — нет.
 */
export function RouteCoverageCard({
  snapshot,
  clients,
  meanHops,
  projectId,
  variantId,
  error,
  onRetry,
}: RouteCoverageCardProps) {
  const stacked = useStacked();

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={
        stacked
          ? 'flex h-full flex-col gap-[12px] p-[20px]'
          : 'absolute left-[552px] top-[570px] h-[323px] w-[781px]'
      }
    >
      <img
        src="/assets/earth-globe.png"
        alt=""
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute',
          stacked
            ? 'right-[-80px] top-[40px] h-[320px] w-[326px] opacity-30'
            : 'left-[99px] top-[44px] h-[448px] w-[457px] opacity-55',
        )}
      />

      {stacked ? (
        <div className="relative flex items-center gap-[12px]">
          <Share2 aria-hidden="true" className="size-[24px] shrink-0 text-accent-blue" />
          <h2 className="text-title-m font-semibold text-ink-primary">Покрытие маршрутов</h2>
        </div>
      ) : (
        <>
          <Share2 aria-hidden="true" className="absolute left-[32px] top-[27px] size-[30px] text-accent-blue" />
          <h2 className="absolute left-[77px] top-[24px] text-title-l font-semibold text-ink-primary">
            Покрытие маршрутов
          </h2>
        </>
      )}

      <p
        className={cx(
          'text-micro font-semibold uppercase text-ink-muted',
          stacked ? 'relative' : 'absolute left-[32px] top-[62px]',
        )}
      >
        Маршруты на отсчёте {snapshot === null ? DASH : formatTick(snapshot.t_s)}
      </p>

      <div className={stacked ? 'relative min-h-[160px]' : 'absolute left-[32px] top-[88px] h-[200px] w-[520px]'}>
        {error !== null && (
          <ErrorBlock title="Маршруты не загрузились" message={error} onRetry={onRetry} />
        )}

        {error === null && snapshot === null && (
          <LoadingBlock label="Загружаем маршруты на первом отсчёте">
            <ul className="space-y-[10px]">
              {[0, 1, 2].map((index) => (
                <li key={index}>
                  <Skeleton className={cx('h-[44px] rounded-sm', stacked ? 'w-full' : 'w-[510px]')} />
                </li>
              ))}
            </ul>
          </LoadingBlock>
        )}

        {error === null && snapshot !== null && snapshot.clients.length === 0 && (
          <EmptyState
            title="Маршрутов на этом отсчёте нет"
            hint="В снимке сети не оказалось ни одного клиента: проверьте роли наземных пунктов в сценарии."
          />
        )}

        {error === null && snapshot !== null && snapshot.clients.length > 0 && (
          <ul className={cx('space-y-[8px]', !stacked && 'scroll-area h-full w-[526px] pr-[6px]')}>
            {snapshot.clients.map((route) => (
              <li
                key={route.client_id}
                className="rounded-sm bg-surface-sunken px-[12px] py-[7px]"
              >
                <p className="flex items-baseline gap-[10px]">
                  <span className="text-[14px] font-semibold text-ink-primary">
                    {route.client_id}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {route.reachable
                      ? `переходов ${route.hops == null ? DASH : String(route.hops)}`
                      : 'маршрута нет'}
                  </span>
                </p>
                {route.reachable ? (
                  <p
                    className="truncate font-mono text-[12px] text-ink-secondary"
                    title={route.path.join(' → ')}
                  >
                    {route.path.join(' → ')}
                  </p>
                ) : (
                  <p
                    className="text-[12px]"
                    style={{
                      color:
                        route.primary_cause == null
                          ? 'var(--text-muted)'
                          : causeView(route.primary_cause).color,
                    }}
                  >
                    {route.primary_cause == null
                      ? 'Причина не определена'
                      : causeView(route.primary_cause).full}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={stacked ? 'relative' : 'absolute left-[579px] top-[73px] w-[172px]'}>
        <p className="text-micro font-semibold uppercase text-ink-muted">Метрики клиентов</p>
        <table className="mt-[14px] w-full text-left">
          <thead>
            <tr className="text-[9px] uppercase tracking-[0.54px] text-ink-muted">
              <th scope="col" className="pb-[6px] font-semibold">
                Клиент
              </th>
              <th scope="col" className="pb-[6px] font-semibold">
                Дост.
              </th>
              <th scope="col" className="pb-[6px] font-semibold">
                Видим.
              </th>
            </tr>
          </thead>
          <tbody>
            {clients === null && (
              <tr>
                <td colSpan={3} className="pt-[8px]">
                  <Skeleton className={cx('h-[56px]', stacked ? 'w-full' : 'w-[172px]')} />
                </td>
              </tr>
            )}
            {clients?.slice(0, 3).map((client) => (
              <tr key={client.client_id} className="text-[12px]">
                <td className="h-[26px] font-semibold text-ink-primary">{client.client_id}</td>
                <td className="font-medium text-ink-secondary">{formatShare(client.availability)}</td>
                <td className="font-medium text-ink-secondary">{formatShare(client.visibility)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-[14px] text-[11px] text-ink-muted">
          среднее число переходов {meanHops == null ? DASH : meanHops.toFixed(1)}
        </p>

        {clients !== null && clients.length > 3 && (
          <p className="text-[11px] text-ink-muted">показаны 3 из {clients.length}</p>
        )}

        {projectId !== null && (
          <Link
            to={`${NETWORK_PATH}/${projectId}${variantId === null ? '' : `?variant=${variantId}`}`}
            // На полотне в колонку 172 пикселя подпись со стрелкой не помещалась: переносилась
            // на две строки, а стрелка уезжала к правому краю. Одна строка шире колонки
            // на несколько пикселей, но справа у карточки ещё есть поле.
            className={cx(
              'mt-[12px] inline-flex items-center gap-[4px] whitespace-nowrap text-[12px] font-semibold text-accent-blue hover:underline',
              stacked && 'min-h-[40px]',
            )}
          >
            Открыть маршрут клиента
            <ChevronRight aria-hidden="true" className="size-[14px]" />
          </Link>
        )}
      </div>
    </Card>
  );
}
