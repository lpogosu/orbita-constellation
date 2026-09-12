import { ChevronRight } from 'lucide-react';

import type { CriticalityState } from './use-comparison';
import { ErrorBlock, Skeleton, UnavailableBlock } from '@/components/state/States';
import { cx } from '@/lib/cx';
import { formatPoints } from './format';
import { formatGap } from '@/lib/run-format';

interface CriticalityCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly state: CriticalityState;
  readonly runId: string | null;
  /** Аппарат, ради которого открыт экран: он стоит первым и подсвечен на карте. */
  readonly focusSatelliteId: string | null;
  readonly onFocusSatellite: (satelliteId: string) => void;
}

/**
 * «Критические аппараты» (`14_SCREENS.md` §3.3), узел макета `43:437`.
 *
 * `POST /api/analysis/criticality` выполняет контрфактический прогон по каждому
 * аппарату и возвращает ранжированный отчёт; карточка показывает метрики влияния.
 */
export function CriticalityCard(props: CriticalityCardProps) {
  const { state, focusSatelliteId } = props;
  // В карточку по макету помещаются три строки. Выбранный на карте аппарат поднимается
  // первой строкой и подсвечивается в самом списке, а не дублируется отдельной плашкой:
  // иначе третья строка выходила бы за жёсткую высоту карточки 212px.
  const bodyHeight = 128;

  const ranked = (state.report?.satellites ?? []).map((item, index) => ({
    item,
    rank: index + 1,
  }));
  const ordered = [
    ...ranked.filter((entry) => entry.item.satellite_id === focusSatelliteId),
    ...ranked.filter((entry) => entry.item.satellite_id !== focusSatelliteId),
  ].slice(0, 3);

  return (
    <div
      className="card-glass absolute px-[20px] pb-[14px] pt-[11px]"
      style={{
        left: props.x,
        top: props.y,
        width: props.width,
        height: props.height,
        backgroundPosition: `0 0, ${-props.x}px ${-props.y}px`,
      }}
    >
      <div className="flex items-center gap-[12px]">
        <h3 className="truncate text-title-m font-semibold text-ink-primary">Критические аппараты</h3>
        <button
          type="button"
          onClick={state.request}
          disabled={props.runId === null || state.loading}
          className="ml-auto shrink-0 whitespace-nowrap text-caption font-semibold text-accent-blue disabled:text-ink-muted"
        >
          {state.loading ? 'Считаем…' : state.report === null ? 'Рассчитать критичность' : 'Пересчитать'}
        </button>
      </div>
      <p className="mt-[6px] text-micro text-ink-muted">
        POST /api/analysis/criticality
        {props.runId !== null && ` · прогон ${props.runId.slice(0, 8)}`}
      </p>

      {props.runId === null ? (
        <div className="mt-[10px]" style={{ height: bodyHeight }}>
          <UnavailableBlock
            title="Нужен завершённый расчёт"
            hint="Выберите готовый прогон или примените отказ — тогда можно рассчитать критичность."
            compact
          />
        </div>
      ) : state.loading ? (
        <Skeleton className="mt-[12px] w-full" style={{ height: bodyHeight }} />
      ) : state.notImplemented ? (
        <div className="mt-[10px]" style={{ height: bodyHeight }}>
          <ErrorBlock
            title="Расчёт критичности ещё не подключён"
            message={`Сервис ответил 501: ${state.error ?? 'endpoint объявлен, реализации ещё нет'}.`}
            onRetry={state.request}
            compact
          />
        </div>
      ) : state.error !== null ? (
        <div className="mt-[10px]" style={{ height: bodyHeight }}>
          <ErrorBlock
            title="Критичность не получена"
            message={state.error}
            onRetry={state.request}
            compact
          />
        </div>
      ) : state.report === null ? (
        <p className="mt-[12px] text-caption text-ink-secondary">
          Нажмите «Рассчитать критичность»: сервис пройдёт по каждому аппарату и вернёт, сколько
          клиентов теряют связь при его отказе.
        </p>
      ) : (
        <ul className="mt-[10px] space-y-[2px]">
          {ordered.map(({ item, rank }) => (
            <li key={item.satellite_id}>
              <button
                type="button"
                onClick={() => { props.onFocusSatellite(item.satellite_id); }}
                className={cx(
                  'flex h-[38px] w-full items-center gap-[16px] rounded-sm px-[20px] text-left',
                  'transition-colors duration-150 hover:bg-surface-rowActive',
                  item.satellite_id === focusSatelliteId && 'bg-surface-rowActive',
                )}
              >
                <span className="text-base text-ink-muted" data-numeric>
                  {rank}
                </span>
                <span
                  title={item.satellite_id}
                  className="min-w-0 flex-1 truncate text-title-m font-semibold text-ink-primary"
                >
                  {item.satellite_id}
                </span>
                <span className="shrink-0 whitespace-nowrap text-caption text-ink-secondary" data-numeric>
                  {formatPoints(item.delta_min_client_availability)} ·{' '}
                  {formatGap(item.delta_worst_max_gap_s)} · клиентов{' '}
                  {item.affected_clients.length} · min-cut{' '}
                  {(item.min_cut_frequency * 100).toFixed(0)}%
                </span>
                <ChevronRight aria-hidden="true" className="size-[20px] shrink-0 text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
