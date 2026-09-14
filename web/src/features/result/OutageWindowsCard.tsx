import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { OutageInterval } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { NETWORK_PATH } from '@/app/sections';
import { cx } from '@/lib/cx';
import { causeView, formatGap, formatTick } from '@/lib/run-format';
import { withTextGrowth } from '@/styles/readable-text';

const LEFT = 1373;
const TOP = 628;

/** Колонки макета (141:1079…141:1082) плюс «конец»: он требуется карточкой экрана. */
const COLUMNS = { client: 23, start: 100, end: 160, duration: 220, cause: 291 } as const;
/**
 * На ужатом полотне подписи колонок растут вместе с текстом (`readable-text.ts`), а шаг
 * «начало — конец» в 60 пикселей рассчитан на макетный капс: «НАЧАЛО» наезжало на
 * «КОНЕЦ». Каждая колонка правее начала отодвигается от предыдущей на свой запас.
 */
const COLUMN_GROWTH = { start: 0, end: 32, duration: 64, cause: 80 } as const;

/** Левый край колонки относительно `origin` с учётом роста текста. */
function columnLeft(column: keyof typeof COLUMN_GROWTH, origin: number): string {
  return withTextGrowth(COLUMNS[column] - origin, COLUMN_GROWTH[column]);
}
/** В потоке начало и конец — одна колонка «интервал»: так причина помещается без прокрутки. */
const HEADERS = ['Клиент', 'Интервал', 'Длит.', 'Причина'] as const;

interface OutageWindowsCardProps {
  outages: readonly OutageInterval[] | null;
  error: string | null;
  onRetry: () => void;
  projectId: string | null;
}

/** Card / Окна недоступности (141:1076): `GET /api/runs/{id}/outages` по убыванию длины. */
export function OutageWindowsCard({ outages, error, onRetry, projectId }: OutageWindowsCardProps) {
  const sorted = useMemo(
    () => (outages === null ? null : [...outages].sort((a, b) => b.duration_s - a.duration_s)),
    [outages],
  );

  const longest = sorted?.[0];
  const totalSeconds = sorted?.reduce((sum, outage) => sum + outage.duration_s, 0) ?? 0;
  const truncated = sorted?.some((outage) => outage.truncated_by_horizon) ?? false;

  const stacked = useStacked();

  const summary = sorted !== null && sorted.length > 0 && (
    <p
      className={cx(
        'text-caption font-medium text-ink-secondary',
        !stacked && 'absolute left-[248px] top-[23px] w-[237px] text-right',
      )}
    >
      {sorted.length} окон · суммарно {formatGap(totalSeconds)}
    </p>
  );

  const states = (
    <>
      {error !== null && (
        <ErrorBlock title="Перерывы не загрузились" message={error} onRetry={onRetry} />
      )}

      {error === null && sorted === null && (
        <LoadingBlock label="Загружаем перерывы связи">
          <ul className={cx('space-y-[4px]', !stacked && 'pl-[6px]')}>
            {[0, 1, 2, 3, 4].map((index) => (
              <li key={index}>
                <Skeleton className={cx('h-[32px] rounded-[8px]', stacked ? 'w-full' : 'w-[466px]')} />
              </li>
            ))}
          </ul>
        </LoadingBlock>
      )}

      {error === null && sorted !== null && sorted.length === 0 && (
        <EmptyState
          title="Перерывов нет"
          hint="Каждый клиент был на связи во всех отсчётах горизонта — окон недоступности расчёт не нашёл."
        />
      )}
    </>
  );

  const footnote = truncated && (
    <p className={cx('text-[11px] text-ink-muted', !stacked && 'absolute left-[23px] top-[345px] w-[460px]')}>
      * перерыв обрезан границей расчёта (ADR-004)
    </p>
  );

  const link = projectId !== null && (
    <Link
      // Отсчёт в адресе — начало самого длинного окна: «Сеть» открывается на нём, а не
      // на нуле, иначе переход заставляет искать это окно заново.
      to={`${NETWORK_PATH}/${projectId}${longest === undefined ? '' : `?t=${longest.start_s}`}`}
      className={cx(
        'inline-flex items-center gap-[4px] text-[13px] font-semibold text-accent-blue hover:underline',
        stacked ? 'min-h-[40px] self-start' : 'absolute left-[23px] top-[365px]',
      )}
    >
      Открыть в таймлайне
      <ChevronRight aria-hidden="true" className="size-[14px]" />
    </Link>
  );

  if (stacked) {
    return (
      <Card className="flex h-full flex-col gap-[8px] p-[20px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-[16px] gap-y-[4px]">
          <h2 className="text-title-m font-semibold text-ink-primary">Окна недоступности</h2>
          {summary}
        </div>

        {error === null && sorted !== null && sorted.length > 0 ? (
          // Пять колонок в узкой колонке телефона не помещаются: таблица держит свою
          // ширину и прокручивается внутри карточки, а не обрезает причину.
          <div className="scroll-area max-h-[420px] overflow-x-auto">
            <table className="w-full min-w-[300px] border-separate border-spacing-0 text-left text-[13px]">
              <thead className="text-[10px] uppercase tracking-[0.7px] text-ink-muted">
                <tr>
                  {HEADERS.map((title) => (
                    <th
                      key={title}
                      scope="col"
                      className="border-b border-line-divider px-[6px] pb-[6px] font-semibold"
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((outage, index) => (
                  <tr
                    key={`${outage.client_id}-${String(outage.start_s)}`}
                    style={{
                      backgroundColor: index % 2 === 1 ? 'var(--surface-row-stripe)' : undefined,
                    }}
                  >
                    <td
                      className="h-[36px] max-w-[96px] truncate px-[6px] font-semibold text-ink-primary"
                      title={outage.client_id}
                    >
                      {outage.client_id}
                    </td>
                    <td className="whitespace-nowrap px-[6px] font-medium text-ink-secondary" data-numeric>
                      {formatTick(outage.start_s)}–{formatTick(outage.end_s)}
                    </td>
                    <td className="whitespace-nowrap px-[6px] font-medium text-ink-secondary" data-numeric>
                      {formatGap(outage.duration_s)}
                      {outage.truncated_by_horizon && <TruncatedMark />}
                    </td>
                    <td
                      className="px-[6px] font-medium text-ink-secondary"
                      title={causeView(outage.primary_cause).full}
                    >
                      <span className="flex items-center gap-[7px] whitespace-nowrap">
                        <span
                          aria-hidden="true"
                          className="size-[9px] shrink-0 rounded-[2px]"
                          style={{ backgroundColor: causeView(outage.primary_cause).color }}
                        />
                        {causeView(outage.primary_cause).short}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="min-h-[220px]">{states}</div>
        )}

        {footnote}
        {link}
      </Card>
    );
  }

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[1373px] top-[628px] h-[400px] w-[508px]"
    >
      <h2 className="absolute left-[23px] top-[17px] text-title-m font-semibold text-ink-primary">
        Окна недоступности
      </h2>
      {summary}

      <div className="absolute left-[23px] top-[55px] h-[18px] w-[460px] text-[10px] font-semibold uppercase tracking-[0.7px] text-ink-muted">
        <span className="absolute" style={{ left: 0 }}>
          Клиент
        </span>
        <span className="absolute" style={{ left: columnLeft('start', COLUMNS.client) }}>
          Начало
        </span>
        <span className="absolute" style={{ left: columnLeft('end', COLUMNS.client) }}>
          Конец
        </span>
        <span className="absolute" style={{ left: columnLeft('duration', COLUMNS.client) }}>
          Длит.
        </span>
        <span className="absolute" style={{ left: columnLeft('cause', COLUMNS.client) }}>
          Причина
        </span>
      </div>
      <div aria-hidden="true" className="absolute left-[23px] top-[73px] h-px w-[460px] bg-line-divider" />

      <div className="absolute left-[17px] top-[81px] h-[256px] w-[478px]">
        {states}

        {error === null && sorted !== null && sorted.length > 0 && (
          <ul className="scroll-area h-full w-[484px]">
            {sorted.map((outage, index) => (
              <li
                key={`${outage.client_id}-${String(outage.start_s)}`}
                className="relative h-[36px] rounded-[8px] text-[13px]"
                style={{
                  backgroundColor: index % 2 === 1 ? 'var(--surface-row-stripe)' : undefined,
                }}
              >
                <span
                  title={outage.client_id}
                  className="absolute top-[10px] truncate pr-[6px] font-semibold text-ink-primary"
                  style={{ left: COLUMNS.client - 17, width: COLUMNS.start - COLUMNS.client }}
                >
                  {outage.client_id}
                </span>
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: columnLeft('start', 17) }}
                  data-numeric
                >
                  {formatTick(outage.start_s)}
                </span>
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: columnLeft('end', 17) }}
                  data-numeric
                >
                  {formatTick(outage.end_s)}
                </span>
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: columnLeft('duration', 17) }}
                  data-numeric
                >
                  {formatGap(outage.duration_s)}
                  {outage.truncated_by_horizon && <TruncatedMark />}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute top-[14px] size-[9px] rounded-[2px]"
                  style={{
                    left: columnLeft('cause', 17),
                    backgroundColor: causeView(outage.primary_cause).color,
                  }}
                />
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: columnLeft('cause', 1) }}
                  title={causeView(outage.primary_cause).full}
                >
                  {causeView(outage.primary_cause).short}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {footnote}
      {link}
    </Card>
  );
}

function TruncatedMark() {
  return (
    <span
      className="text-status-warning"
      title="Перерыв обрезан границей расчёта: он мог начаться до 00:00 или продолжиться после 24:00 (ADR-004)"
    >
      *
    </span>
  );
}
