import type { ClientMetrics } from '@/api/types';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { DASH, formatGap, formatShare } from '@/lib/run-format';

/** Полоса карточек клиентов: (37, 249), карточка 405×308, шаг 445 (узел 49:626). */
const BAND_LEFT = 37;
const BAND_TOP = 249;
const BAND_WIDTH = 1295;
const CARD_WIDTH = 405;
const CARD_HEIGHT = 308;
const CARD_GAP = 40;

/** Цвет точки клиента — опознавательный знак карточки, а не статус: три цвета по кругу. */
const DOT_COLORS = ['bg-[#ff3d9a]', 'bg-accent-violet-light', 'bg-accent-blue'] as const;

function dotColor(index: number): string {
  return DOT_COLORS[index % DOT_COLORS.length] ?? DOT_COLORS[0];
}

interface ClientStatCardsProps {
  clients: readonly ClientMetrics[] | null;
  /** Цель из сценария варианта; пока вариант не загружен — `null`. */
  targetAvailability: number | null;
  error: string | null;
  onRetry: () => void;
}

export function ClientStatCards({
  clients,
  targetAvailability,
  error,
  onRetry,
}: ClientStatCardsProps) {
  return (
    <div
      className="absolute"
      style={{ left: BAND_LEFT, top: BAND_TOP, width: BAND_WIDTH, height: CARD_HEIGHT }}
    >
      {error !== null && (
        <Card sceneX={BAND_LEFT} sceneY={BAND_TOP} className="h-full w-full">
          <ErrorBlock title="Метрики не загрузились" message={error} onRetry={onRetry} />
        </Card>
      )}

      {error === null && clients === null && (
        <LoadingBlock label="Загружаем метрики клиентов">
          {/* Скелетон повторяет форму карточек, а не заполняет полосу одним блоком. */}
          <div className="flex gap-[40px]">
            {[0, 1, 2].map((index) => (
              <Skeleton
                key={index}
                className="rounded-2xl"
                style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
              />
            ))}
          </div>
        </LoadingBlock>
      )}

      {error === null && clients !== null && clients.length === 0 && (
        <Card sceneX={BAND_LEFT} sceneY={BAND_TOP} className="h-full w-full">
          <EmptyState
            title="Клиентов в расчёте нет"
            hint="В сценарии не объявлено ни одного наземного пункта с ролью клиента."
          />
        </Card>
      )}

      {error === null && clients !== null && clients.length > 0 && (
        // Полоса ровно по высоте карточек: нижний отступ добавлял седьмой десяток
        // пикселей содержимому и включал вертикальную прокрутку поверх карточек.
        <ul className="flex h-full gap-[40px] overflow-x-auto [scrollbar-width:thin]">
          {clients.map((client, index) => (
            <li key={client.client_id} className="shrink-0">
              <ClientStatCard
                client={client}
                target={targetAvailability}
                sceneX={BAND_LEFT + index * (CARD_WIDTH + CARD_GAP)}
                dot={dotColor(index)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Card / Stat Result (14:12). Кроме доступности, цели и максимального перерыва из макета
 * карточка показывает видимость, переходы и перестроения: разница между «спутник виден»
 * и «маршрут есть» — главный вывод расчёта (`14_SCREENS.md` §4).
 */
function ClientStatCard({
  client,
  target,
  sceneX,
  dot,
}: {
  client: ClientMetrics;
  target: number | null;
  sceneX: number;
  dot: string;
}) {
  const met = target === null ? client.target_met : client.availability >= target;

  return (
    <Card
      sceneX={sceneX}
      sceneY={BAND_TOP}
      className="relative"
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
    >
      {/* Отступ от правого и нижнего края больше, чем кажется нужным на глаз: у самого
          скругления карточки блик антенны читался как утечка света за её пределы. */}
      <img
        src="/assets/ground-station-dish.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-[225px] top-[140px] h-[140px] w-[152px] opacity-80"
      />

      <div className="absolute left-[30px] top-[26px] flex w-[345px] items-center gap-[14px]">
        <span aria-hidden="true" className={cx('size-[17px] shrink-0 rounded-pill', dot)} />
        <span
          title={client.client_id}
          className="min-w-0 truncate font-display text-[26px] font-bold leading-[1.1] text-ink-primary"
        >
          {client.client_id}
        </span>
      </div>

      <p
        className={cx(
          'absolute left-[30px] top-[56px] font-display text-[60px] font-bold leading-none tracking-[-1px]',
          met ? 'text-accent-cyan' : 'text-status-warning',
        )}
        // Свечение цифры в макете — эффект Glow/Cyan; как тень текста тот же токен
        // работает без лишнего слоя, а в светлой теме он выключен.
        style={met ? { textShadow: 'var(--shadow-glow-cyan)' } : undefined}
        data-numeric
      >
        {formatShare(client.availability)}
      </p>

      <div className="absolute left-[30px] top-[134px] flex items-center gap-[12px]">
        <span className="text-body text-ink-secondary">Цель</span>
        <span className="text-title-m font-semibold text-ink-primary" data-numeric>
          {target === null ? DASH : formatShare(target)}
        </span>
        <span
          className={cx(
            'text-caption font-semibold',
            met ? 'text-status-success' : 'text-status-warning',
          )}
        >
          {met ? 'достигнута' : 'не достигнута'}
        </span>
      </div>

      <div aria-hidden="true" className="absolute left-[30px] top-[172px] h-px w-[345px] bg-line-divider" />

      <div className="absolute left-[30px] top-[184px] flex items-center gap-[16px]">
        <span
          aria-hidden="true"
          className="flex size-[34px] items-center justify-center rounded-pill border border-status-warning text-title-m font-semibold text-status-warning"
        >
          !
        </span>
        <span className="flex flex-col gap-[2px]">
          <span className="text-[16px] leading-[1.45] text-ink-secondary">Макс. перерыв</span>
          <span className="text-title-l font-semibold text-ink-primary" data-numeric>
            {formatGap(client.max_gap_s)}
          </span>
        </span>
      </div>

      <dl className="absolute left-[30px] top-[238px] w-[222px]">
        <Extra label="Видимость" value={formatShare(client.visibility)} />
        <Extra
          label="Переходы"
          value={
            client.mean_hops == null
              ? DASH
              : `${client.mean_hops.toFixed(1)} · макс ${client.max_hops == null ? DASH : String(client.max_hops)}`
          }
        />
        <Extra label="Перестроений" value={String(client.route_switches)} />
      </dl>
    </Card>
  );
}

function Extra({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-[20px] items-baseline justify-between">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-[13px] font-semibold text-ink-secondary" data-numeric>
        {value}
      </dd>
    </div>
  );
}
