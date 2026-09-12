import { ChevronRight } from 'lucide-react';

import type { CriticalityState } from './use-comparison';
import { Skeleton, UnavailableBlock } from '@/components/state/States';
import { formatPoints } from './format';
import { formatSpan } from '@/timeline/segments';

interface CriticalityCardProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly state: CriticalityState;
  readonly runId: string | null;
  readonly onCheckFailure: (satelliteId: string) => void;
}

/**
 * «Критические аппараты» (`14_SCREENS.md` §3.3), узел макета `43:437`.
 *
 * `POST /api/analysis/criticality` отвечает 501: реализации ещё нет. Кнопка вызывает
 * endpoint по-настоящему, а ответ показывается как есть — списка с выдуманными рангами
 * на экране нет и не будет, пока сервис не начнёт считать.
 */
export function CriticalityCard(props: CriticalityCardProps) {
  const { state } = props;

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
      <div className="flex items-center">
        <h3 className="text-title-m font-semibold text-ink-primary">Критические аппараты</h3>
        <button
          type="button"
          onClick={state.request}
          disabled={props.runId === null || state.loading}
          className="ml-auto text-caption font-semibold text-accent-blue disabled:text-ink-muted"
        >
          {state.loading ? 'Считаем…' : state.report === null ? 'Рассчитать критичность' : 'Пересчитать'}
        </button>
      </div>
      <p className="mt-[6px] text-micro text-ink-muted">
        POST /api/analysis/criticality
        {props.runId !== null && ` · прогон ${props.runId.slice(0, 8)}`}
      </p>

      {props.runId === null ? (
        <div className="mt-[10px] h-[128px]">
          <UnavailableBlock
            title="Нужен завершённый расчёт"
            hint="Критичность считается по готовому прогону: сначала «Применить отказ» или выберите базу сравнения."
          />
        </div>
      ) : state.loading ? (
        <Skeleton className="mt-[12px] h-[128px] w-full" />
      ) : state.notImplemented ? (
        <div className="mt-[10px] h-[128px]">
          <UnavailableBlock
            title="Не подключено"
            hint={`Сервис ответил 501: ${state.error ?? 'endpoint объявлен, реализации ещё нет'}. Ранги появятся, когда анализ заработает.`}
          />
        </div>
      ) : state.error !== null ? (
        <p role="alert" className="mt-[12px] text-caption text-status-danger">
          {state.error}
        </p>
      ) : state.report === null ? (
        <p className="mt-[12px] text-caption text-ink-secondary">
          Нажмите «Рассчитать критичность»: сервис пройдёт по каждому аппарату и вернёт, сколько
          клиентов теряют связь при его отказе.
        </p>
      ) : (
        <ul className="mt-[10px] space-y-[2px]">
          {state.report.satellites.slice(0, 3).map((item, index) => (
            <li key={item.satellite_id}>
              <button
                type="button"
                onClick={() => { props.onCheckFailure(item.satellite_id); }}
                className="flex h-[38px] w-full items-center gap-[16px] rounded-sm px-[20px] text-left transition-colors duration-150 hover:bg-surface-rowActive"
              >
                <span className="text-base text-ink-muted" data-numeric>
                  {index + 1}
                </span>
                <span className="flex-1 text-title-m font-semibold text-ink-primary">
                  {item.satellite_id}
                </span>
                <span className="text-base text-ink-secondary" data-numeric>
                  {formatPoints(item.delta_min_client_availability)} ·{' '}
                  {formatSpan(item.delta_worst_max_gap_s)} · клиентов{' '}
                  {item.affected_clients.length}
                </span>
                <ChevronRight aria-hidden="true" className="size-[20px] text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
