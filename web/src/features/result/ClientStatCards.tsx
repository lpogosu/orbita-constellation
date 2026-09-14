import type { ClientMetrics } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
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

/** Сетка карточек в потоке: одна колонка на телефоне, две на планшете, три шире. */
const STACKED_GRID = 'grid gap-[16px] sm:grid-cols-2 lg:grid-cols-3';

/**
 * Последняя карточка при нечётном числе клиентов. В две колонки планшета она осталась бы
 * одна с пустым местом рядом, поэтому занимает всю строку и раскладывает показатели в две
 * колонки.
 */
function lastOdd(index: number, count: number): boolean {
  return count % 2 === 1 && index === count - 1;
}

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
  const stacked = useStacked();

  if (stacked) {
    return (
      <div>
        {error !== null && (
          <Card className="min-h-[240px]">
            <ErrorBlock title="Метрики не загрузились" message={error} onRetry={onRetry} />
          </Card>
        )}

        {error === null && clients === null && (
          <LoadingBlock label="Загружаем метрики клиентов">
            <div className={STACKED_GRID}>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-[280px] rounded-2xl" />
              ))}
            </div>
          </LoadingBlock>
        )}

        {error === null && clients !== null && clients.length === 0 && (
          <Card className="min-h-[200px]">
            <EmptyState
              title="Клиентов в расчёте нет"
              hint="В сценарии не объявлено ни одного наземного пункта с ролью клиента."
            />
          </Card>
        )}

        {error === null && clients !== null && clients.length > 0 && (
          <ul className={STACKED_GRID}>
            {clients.map((client, index) => (
              <li
                key={client.client_id}
                className={cx('min-w-0', lastOdd(index, clients.length) && 'sm:max-lg:col-span-2')}
              >
                <ClientStatCard
                  client={client}
                  target={targetAvailability}
                  sceneX={0}
                  dot={dotColor(index)}
                  wide={lastOdd(index, clients.length)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

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
  wide = false,
}: {
  client: ClientMetrics;
  target: number | null;
  sceneX: number;
  dot: string;
  /** Карточка во всю строку планшета; на полотне не используется. */
  wide?: boolean;
}) {
  const stacked = useStacked();
  const met = target === null ? client.target_met : client.availability >= target;

  const extras = (
    <>
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
    </>
  );

  const share = (
    <p
      className={cx(
        'font-display font-bold leading-none tracking-[-1px]',
        stacked ? 'text-[48px] lg:text-[40px]' : 'absolute left-[30px] top-[56px] text-[60px]',
        met ? 'text-accent-cyan' : 'text-status-warning',
      )}
      // Свечение цифры в макете — эффект Glow/Cyan; как тень текста тот же токен
      // работает без лишнего слоя, а в светлой теме он выключен.
      style={met ? { textShadow: 'var(--shadow-glow-cyan)' } : undefined}
      data-numeric
    >
      {formatShare(client.availability)}
    </p>
  );

  const goal = (
    <>
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
    </>
  );

  const gap = (
    <>
      <span
        aria-hidden="true"
        className="flex size-[34px] shrink-0 items-center justify-center rounded-pill border border-status-warning text-title-m font-semibold text-status-warning"
      >
        !
      </span>
      <span className="flex flex-col gap-[2px]">
        <span className="text-[16px] leading-[1.45] text-ink-secondary">Макс. перерыв</span>
        <span className="text-title-l font-semibold text-ink-primary" data-numeric>
          {formatGap(client.max_gap_s)}
        </span>
      </span>
    </>
  );

  if (stacked) {
    return (
      <Card
        className={cx(
          'flex h-full flex-col gap-[12px] p-[20px]',
          wide && 'sm:max-lg:grid sm:max-lg:grid-cols-2 sm:max-lg:items-center sm:max-lg:gap-x-[32px]',
        )}
      >
        {/* В узкой карточке антенна уходит в верхний угол: внизу она ложилась бы на
            значения видимости и переходов. */}
        <img
          src="/assets/ground-station-dish.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-[12px] top-[12px] h-[88px] w-[96px] object-contain opacity-80 lg:h-[72px] lg:w-[80px]"
        />
        <div className="flex min-w-0 flex-col gap-[12px]">
          <div className="flex items-center gap-[12px] pr-[100px]">
            <span aria-hidden="true" className={cx('size-[14px] shrink-0 rounded-pill', dot)} />
            <span
              title={client.client_id}
              className="min-w-0 truncate font-display text-[22px] font-bold leading-[1.1] text-ink-primary"
            >
              {client.client_id}
            </span>
          </div>
          {share}
          <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">{goal}</div>
        </div>
        <div
          className={cx(
            'flex min-w-0 flex-col gap-[12px] border-line-divider',
            wide && 'sm:max-lg:border-l sm:max-lg:pl-[32px] sm:max-lg:pt-[72px]',
          )}
        >
          <div aria-hidden="true" className={cx('h-px bg-line-divider', wide && 'sm:max-lg:hidden')} />
          <div className="flex items-center gap-[16px]">{gap}</div>
          <dl>{extras}</dl>
        </div>
      </Card>
    );
  }

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

      {share}

      <div className="absolute left-[30px] top-[134px] flex items-center gap-[12px]">{goal}</div>

      <div aria-hidden="true" className="absolute left-[30px] top-[172px] h-px w-[345px] bg-line-divider" />

      <div className="absolute left-[30px] top-[184px] flex items-center gap-[16px]">{gap}</div>

      <dl className="absolute left-[30px] top-[238px] w-[222px]">{extras}</dl>
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
