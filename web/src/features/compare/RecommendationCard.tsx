import { ArrowLeftRight, ChevronRight } from 'lucide-react';
import { useCallback } from 'react';

import { getRecommendation } from '@/api/comparisons';
import type { ComparisonEntry, Recommendation } from '@/api/types';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { deltaArrow, deltaTone, formatPoints } from '@/lib/measures';
import { formatGap, variantLetter } from '@/lib/run-format';
import { useResource } from '@/lib/use-resource';

const LEFT = 1202;
const TOP = 564;

/** Имена метрик ранжирования (ADR-006) словами: `ranking_order` приходит ключами API. */
const CRITERION_TITLES: Record<string, string> = {
  min_client_availability: 'min доступность',
  worst_max_gap_s: 'худший перерыв',
  mean_client_availability: 'средняя доступность',
  backup_path_count_min: 'резервные пути',
  route_switches_total: 'переключения маршрута',
  mean_hops: 'среднее число переходов',
};

interface RecommendationCardProps {
  readonly entries: readonly ComparisonEntry[];
  readonly onApply: (variantId: string) => void;
  readonly onSwap: () => void;
}

/**
 * «Рекомендация» (узел Figma `47:853`). Вывод целиком приходит из
 * `GET /api/runs/{id}/recommendation`: экран не ранжирует варианты сам, иначе на демо
 * пришлось бы объяснять, почему две части системы считают по-разному.
 *
 * Сравнение попарное, поэтому кандидат — второй вариант строки: с третьим и четвёртым
 * вывод пришлось бы запрашивать отдельно на каждую пару и мирить между собой.
 */
export function RecommendationCard({ entries, onApply, onSwap }: RecommendationCardProps) {
  const base = entries[0];
  const candidate = entries[1];
  const baseRunId = base?.run_id ?? '';
  const candidateRunId = candidate?.run_id ?? '';

  const load = useCallback(
    () => getRecommendation(candidateRunId, baseRunId),
    [candidateRunId, baseRunId],
  );
  const recommendation = useResource<Recommendation>(load);

  if (base === undefined || candidate === undefined) {
    return null;
  }

  const winner =
    recommendation.data === null
      ? null
      : entries.find((entry) => entry.run_id === recommendation.data?.recommended_run_id);
  const winnerIsBase = winner?.run_id === base.run_id;

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute h-[288px] w-[692px]"
      style={{ left: LEFT, top: TOP }}
    >
      <p className="absolute left-[27px] top-[13px] text-[11px] font-semibold tracking-[0.88px] text-accent-cyan">
        РЕКОМЕНДАЦИЯ · ranking_order
      </p>

      {recommendation.error !== null ? (
        <div className="absolute inset-x-[27px] top-[40px] h-[170px]">
          <ErrorBlock
            title="Вывод не получен"
            message={recommendation.error}
            onRetry={recommendation.reload}
          />
        </div>
      ) : recommendation.data === null ? (
        <LoadingBlock label="Загрузка рекомендации">
          <div className="absolute inset-x-[27px] top-[40px] space-y-[12px]">
            <Skeleton className="h-[28px] w-[300px]" />
            <Skeleton className="h-[16px] w-[420px]" />
            <Skeleton className="h-[96px] w-[440px]" />
          </div>
        </LoadingBlock>
      ) : (
        <Verdict
          recommendation={recommendation.data}
          winnerTitle={winner?.variant_title ?? '—'}
          winnerLetter={variantLetter(entries.findIndex((entry) => entry.run_id === winner?.run_id))}
          winnerIsBase={winnerIsBase}
        />
      )}

      <img
        src="/assets/mascot-recommendation.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-[485px] top-[87px] h-[120px] w-[180px] object-contain"
      />

      <button
        type="button"
        onClick={() => { onApply(winnerIsBase ? base.variant_id : candidate.variant_id); }}
        className={cx(
          'absolute left-[27px] top-[223px] flex h-[50px] w-[300px] items-center justify-center gap-3',
          'rounded-lg bg-accent-violet text-[22px] font-semibold text-ink-onAccent shadow-glow-violet',
          'transition-[filter] duration-150 hover:brightness-110',
        )}
      >
        Применить вариант
        <ChevronRight aria-hidden="true" className="size-6" />
      </button>

      <button
        type="button"
        onClick={onSwap}
        className={cx(
          'absolute left-[343px] top-[223px] flex h-[50px] w-[220px] items-center justify-center gap-3',
          'rounded-lg border border-line bg-surface-input text-[22px] font-semibold text-ink-primary',
          'transition-colors duration-150 hover:border-line-strong',
        )}
      >
        <ArrowLeftRight aria-hidden="true" className="size-6" />
        Поменять местами
      </button>
    </Card>
  );
}

function Verdict({
  recommendation,
  winnerTitle,
  winnerLetter,
  winnerIsBase,
}: {
  recommendation: Recommendation;
  winnerTitle: string;
  winnerLetter: string;
  winnerIsBase: boolean;
}) {
  const availabilityDelta = recommendation.deltas['min_client_availability'];

  return (
    <>
      <h2 className="absolute left-[27px] top-[31px] max-w-[440px] truncate text-title-l font-bold tracking-[-0.8px] text-accent-cyan">
        {winnerIsBase
          ? 'Изменение не улучшает худшего клиента'
          : `Вариант ${winnerLetter} — лучший`}
      </h2>

      <p className="absolute left-[27px] top-[67px] w-[440px] text-[13px] leading-[1.35] text-ink-secondary">
        {winnerIsBase ? 'Лучшим остаётся база' : winnerTitle}
        {availabilityDelta === undefined
          ? ''
          : `: min доступность ${availabilityDelta >= 0 ? 'выше' : 'ниже'} на ${formatPoints(availabilityDelta)}`}
        .{' '}
        {recommendation.target_reached
          ? 'Цель достигнута: ни один клиент не ниже целевой доступности.'
          : 'Цель не достигнута: хотя бы один клиент остаётся ниже целевой доступности.'}
      </p>

      <div className="scroll-area absolute left-[27px] top-[111px] h-[100px] w-[446px] pr-[6px]">
        <p className="text-[10px] font-semibold tracking-[0.8px] text-ink-muted">
          ПОРЯДОК КРИТЕРИЕВ
        </p>
        <ol className="mt-[6px] flex flex-wrap gap-[6px]">
          {recommendation.ranking_order.map((criterion, index) => (
            <li
              key={criterion}
              className="rounded-sm bg-surface-chip px-[8px] py-[3px] text-[11px] text-ink-secondary"
            >
              {index + 1}. {CRITERION_TITLES[criterion] ?? criterion}
            </li>
          ))}
        </ol>

        <p className="mt-[12px] text-[10px] font-semibold tracking-[0.8px] text-ink-muted">
          ПО КЛИЕНТАМ
        </p>
        <ul className="mt-[4px]">
          {recommendation.per_client.map((client) => (
            <li key={client.client_id} className="flex items-center gap-[12px] py-[2px] text-[12px]">
              <span className="w-[52px] font-semibold text-ink-primary">{client.client_id}</span>
              <span
                className={cx(
                  'w-[120px]',
                  deltaTone(client.availability_delta, 'up') === 'good'
                    ? 'text-status-success'
                    : 'text-status-danger',
                )}
                data-numeric
              >
                {deltaArrow(client.availability_delta)} {formatPoints(client.availability_delta)}
              </span>
              <span
                className={cx(
                  deltaTone(client.max_gap_delta_s, 'down') === 'good'
                    ? 'text-status-success'
                    : 'text-status-danger',
                )}
                data-numeric
              >
                {deltaArrow(client.max_gap_delta_s)} {formatGap(client.max_gap_delta_s)} перерыв
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-[12px] text-[10px] font-semibold tracking-[0.8px] text-ink-muted">
          ОГРАНИЧЕНИЯ
        </p>
        <ul className="mt-[4px] list-inside list-disc text-[12px] text-ink-secondary">
          {recommendation.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
