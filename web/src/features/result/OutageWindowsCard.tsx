import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { OutageInterval } from '@/api/types';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { NETWORK_PATH } from '@/app/sections';
import { causeView, formatGap, formatTick } from '@/lib/run-format';

const LEFT = 1373;
const TOP = 628;

/** Колонки макета (141:1079…141:1082) плюс «конец»: он требуется карточкой экрана. */
const COLUMNS = { client: 23, start: 100, end: 160, duration: 220, cause: 291 } as const;

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

  const totalSeconds = sorted?.reduce((sum, outage) => sum + outage.duration_s, 0) ?? 0;
  const truncated = sorted?.some((outage) => outage.truncated_by_horizon) ?? false;

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[1373px] top-[628px] h-[400px] w-[508px]"
    >
      <h2 className="absolute left-[23px] top-[17px] text-title-m font-semibold text-ink-primary">
        Окна недоступности
      </h2>
      {sorted !== null && sorted.length > 0 && (
        <p className="absolute left-[248px] top-[23px] w-[237px] text-right text-caption font-medium text-ink-secondary">
          {sorted.length} окон · суммарно {formatGap(totalSeconds)}
        </p>
      )}

      <div className="absolute left-[23px] top-[55px] h-[18px] w-[460px] text-[10px] font-semibold uppercase tracking-[0.7px] text-ink-muted">
        <span className="absolute" style={{ left: 0 }}>
          Клиент
        </span>
        <span className="absolute" style={{ left: COLUMNS.start - COLUMNS.client }}>
          Начало
        </span>
        <span className="absolute" style={{ left: COLUMNS.end - COLUMNS.client }}>
          Конец
        </span>
        <span className="absolute" style={{ left: COLUMNS.duration - COLUMNS.client }}>
          Длит.
        </span>
        <span className="absolute" style={{ left: COLUMNS.cause - COLUMNS.client }}>
          Причина
        </span>
      </div>
      <div aria-hidden="true" className="absolute left-[23px] top-[73px] h-px w-[460px] bg-line-divider" />

      <div className="absolute left-[17px] top-[81px] h-[256px] w-[478px]">
        {error !== null && (
          <ErrorBlock title="Перерывы не загрузились" message={error} onRetry={onRetry} />
        )}

        {error === null && sorted === null && (
          <LoadingBlock label="Загружаем перерывы связи">
            <ul className="space-y-[4px] pl-[6px]">
              {[0, 1, 2, 3, 4].map((index) => (
                <li key={index}>
                  <Skeleton className="h-[32px] w-[466px] rounded-[8px]" />
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
                  className="absolute top-[10px] font-semibold text-ink-primary"
                  style={{ left: COLUMNS.client - 17 }}
                >
                  {outage.client_id}
                </span>
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: COLUMNS.start - 17 }}
                  data-numeric
                >
                  {formatTick(outage.start_s)}
                </span>
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: COLUMNS.end - 17 }}
                  data-numeric
                >
                  {formatTick(outage.end_s)}
                </span>
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: COLUMNS.duration - 17 }}
                  data-numeric
                >
                  {formatGap(outage.duration_s)}
                  {outage.truncated_by_horizon && (
                    <span
                      className="text-status-warning"
                      title="Перерыв обрезан границей расчёта: он мог начаться до 00:00 или продолжиться после 24:00 (ADR-004)"
                    >
                      *
                    </span>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute top-[14px] size-[9px] rounded-[2px]"
                  style={{
                    left: COLUMNS.cause - 17,
                    backgroundColor: causeView(outage.primary_cause).color,
                  }}
                />
                <span
                  className="absolute top-[10px] font-medium text-ink-secondary"
                  style={{ left: COLUMNS.cause - 1 }}
                  title={causeView(outage.primary_cause).full}
                >
                  {causeView(outage.primary_cause).short}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {truncated && (
        <p className="absolute left-[23px] top-[345px] w-[460px] text-[11px] text-ink-muted">
          * перерыв обрезан границей расчёта (ADR-004)
        </p>
      )}

      {projectId !== null && (
        <Link
          to={`${NETWORK_PATH}/${projectId}`}
          className="absolute left-[23px] top-[365px] inline-flex items-center gap-[4px] text-[13px] font-semibold text-accent-blue hover:underline"
        >
          Открыть в таймлайне
          <ChevronRight aria-hidden="true" className="size-[14px]" />
        </Link>
      )}
    </Card>
  );
}
