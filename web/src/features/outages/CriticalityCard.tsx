import { ChevronRight } from 'lucide-react';

import type { CriticalityState } from './use-comparison';
import { ErrorBlock, Skeleton, UnavailableBlock } from '@/components/state/States';
import { cx } from '@/lib/cx';
import { formatPoints } from './format';
import { formatGap } from '@/lib/run-format';
import { useCardBox } from '@/components/layout/box';
import { useStacked } from '@/app/viewport-mode';

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

  const box = useCardBox(props);
  const stacked = useStacked();

  return (
    <div
      className={`card-glass ${box.positionClass} px-[20px] pb-[14px] pt-[11px]`}
      style={box.style}
    >
      <div className={cx('flex items-center', stacked ? 'flex-wrap gap-x-[12px]' : 'gap-[12px]')}>
        <h3 className="truncate text-title-m font-semibold text-ink-primary">Критические аппараты</h3>
        <button
          type="button"
          onClick={state.request}
          disabled={props.runId === null || state.loading}
          className={cx(
            'ml-auto shrink-0 whitespace-nowrap text-caption font-semibold text-accent-blue disabled:text-ink-muted',
            stacked && 'h-[40px]',
          )}
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
            hint="Выберите базу сравнения или примените отказ."
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
                  'flex w-full items-center rounded-sm text-left',
                  // В потоке метрики не помещаются в строку рядом с аппаратом и уходят
                  // второй строкой под него, а не за край карточки.
                  stacked ? 'min-h-[56px] gap-[12px] px-[12px] py-[6px]' : 'h-[38px] gap-[16px] px-[20px]',
                  'transition-colors duration-150 hover:bg-surface-rowActive',
                  item.satellite_id === focusSatelliteId && 'bg-surface-rowActive',
                )}
              >
                <span className="text-base text-ink-muted" data-numeric>
                  {rank}
                </span>
                <span className={cx('min-w-0 flex-1', stacked ? 'flex flex-col' : 'flex items-center gap-[16px]')}>
                  <span
                    title={item.satellite_id}
                    className="min-w-0 flex-1 truncate text-title-m font-semibold text-ink-primary"
                  >
                    {item.satellite_id}
                  </span>
                  <span
                    className={cx('text-caption text-ink-secondary', !stacked && 'shrink-0 whitespace-nowrap')}
                    data-numeric
                  >
                    {formatPoints(item.delta_min_client_availability)} ·{' '}
                    {formatGap(item.delta_worst_max_gap_s)} · клиентов{' '}
                    {item.affected_clients.length} · min-cut{' '}
                    {(item.min_cut_frequency * 100).toFixed(0)}%
                  </span>
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
