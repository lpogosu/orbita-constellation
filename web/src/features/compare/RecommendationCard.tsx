import { ArrowLeftRight, ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { getRecommendation } from '@/api/comparisons';
import type { ComparisonEntry, Recommendation } from '@/api/types';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
            compact
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
        <>
          <Verdict
            recommendation={recommendation.data}
            winnerTitle={winner?.variant_title ?? '—'}
            winnerLetter={variantLetter(entries.findIndex((entry) => entry.run_id === winner?.run_id))}
            winnerIsBase={winnerIsBase}
            onOpenDetails={() => { setDetailsOpen(true); }}
          />
          {detailsOpen && (
            <RecommendationDetailsModal
              recommendation={recommendation.data}
              onClose={() => { setDetailsOpen(false); }}
            />
          )}
        </>
      )}

      <img
        src="/assets/mascot-recommendation.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-[485px] top-[87px] h-[120px] w-[180px] object-contain"
      />

      {/*
        Обе кнопки одной высоты и одной ширины: «Поменять местами» в 220 пикселях
        ломалось на две строки и выпадало из своих 50 по высоте.
      */}
      <div className="absolute inset-x-[27px] top-[223px] flex h-[50px] items-stretch gap-[11px]">
        <button
          type="button"
          onClick={() => { onApply(winnerIsBase ? base.variant_id : candidate.variant_id); }}
          className={cx(
            'flex w-[300px] shrink-0 items-center justify-center gap-3 whitespace-nowrap',
            'rounded-lg bg-accent-violet text-[22px] font-semibold text-ink-onAccent shadow-glow-violet',
            'transition-[filter] duration-150 hover:brightness-110',
          )}
        >
          Применить вариант
          <ChevronRight aria-hidden="true" className="size-6 shrink-0" />
        </button>

        <button
          type="button"
          onClick={onSwap}
          className={cx(
            'flex w-[300px] shrink-0 items-center justify-center gap-3 whitespace-nowrap',
            'rounded-lg border border-line bg-surface-input text-[22px] font-semibold text-ink-primary',
            'transition-colors duration-150 hover:border-line-strong',
          )}
        >
          <ArrowLeftRight aria-hidden="true" className="size-6 shrink-0" />
          Поменять местами
        </button>
      </div>
    </Card>
  );
}

function Verdict({
  recommendation,
  winnerTitle,
  winnerLetter,
  winnerIsBase,
  onOpenDetails,
}: {
  recommendation: Recommendation;
  winnerTitle: string;
  winnerLetter: string;
  winnerIsBase: boolean;
  onOpenDetails: () => void;
}) {
  const availabilityDelta = recommendation.deltas['min_client_availability'];
  const change = availabilityDelta === undefined
    ? ''
    : ` минимум ${availabilityDelta >= 0 ? 'выше' : 'ниже'} на ${formatPoints(availabilityDelta)}.`;
  const summary = winnerIsBase
    ? `База остаётся лучшей:${change} ${recommendation.target_reached ? 'Цель достигнута.' : 'Цель ещё не достигнута.'}`
    : `${winnerTitle} — лучший вариант:${change} ${recommendation.target_reached ? 'Цель достигнута.' : 'Цель ещё не достигнута.'}`;

  return (
    /* Длинные списки открываются явно в окне деталей, а не скрываются за прокруткой
       небольшой карточки рекомендации. */
    <div className="absolute left-[27px] top-[31px] flex h-[184px] w-[446px] flex-col">
      <h2 className="shrink-0 text-[20px] font-bold leading-[1.1] tracking-[-0.55px] text-accent-cyan">
        {winnerIsBase
          ? 'Изменение не улучшает худшего клиента'
          : `Вариант ${winnerLetter} — лучший`}
      </h2>

      <p className="mt-[3px] shrink-0 text-[13px] leading-[1.35] text-ink-secondary">
        {summary}
      </p>

      <p className="mt-[10px] shrink-0 text-[10px] font-semibold tracking-[0.8px] text-ink-muted">
        ПОРЯДОК КРИТЕРИЕВ
      </p>
      <ol className="mt-[5px] flex shrink-0 flex-wrap gap-[5px]">
        {recommendation.ranking_order.map((criterion, index) => (
          <li
            key={criterion}
            className="rounded-sm bg-surface-chip px-[7px] py-[2px] text-[10px] text-ink-secondary"
          >
            {index + 1}. {CRITERION_TITLES[criterion] ?? criterion}
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onOpenDetails}
        className="mt-[10px] flex h-[34px] w-fit items-center rounded-sm border border-line bg-surface-input px-[12px] text-[12px] font-semibold text-ink-primary transition-colors hover:border-line-strong"
      >
        Подробнее: {recommendation.per_client.length} клиентов
        {recommendation.limitations.length > 0 && ` · ${recommendation.limitations.length} ограничений`}
      </button>
    </div>
  );
}

function RecommendationDetailsModal({
  recommendation,
  onClose,
}: {
  recommendation: Recommendation;
  onClose: () => void;
}) {
  const modal = (
    <Modal
      title="Детали рекомендации"
      subtitle="Изменения показаны относительно базового варианта."
      align="start"
      width={760}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Закрыть</Button>}
    >
      <section aria-labelledby="recommendation-clients-title">
        <h3
          id="recommendation-clients-title"
          className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted"
        >
          По клиентам · {recommendation.per_client.length}
        </h3>
        {recommendation.per_client.length === 0 ? (
          <p className="mt-[10px] text-small text-ink-secondary">Нет данных по клиентам.</p>
        ) : (
          <ul className="mt-[10px] divide-y divide-line rounded-sm border border-line bg-surface-input px-[14px]">
            {recommendation.per_client.map((client) => (
              <li
                key={client.client_id}
                className="grid grid-cols-[minmax(96px,1fr)_minmax(150px,1fr)_minmax(190px,1fr)] gap-[16px] py-[10px] text-small"
              >
                <span className="truncate font-semibold text-ink-primary" title={client.client_id}>
                  {client.client_id}
                </span>
                <span
                  className={cx(
                    deltaTone(client.availability_delta, 'up') === 'good'
                      ? 'text-status-success'
                      : 'text-status-danger',
                  )}
                  data-numeric
                >
                  {deltaArrow(client.availability_delta)} {formatPoints(client.availability_delta)} доступность
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
        )}
      </section>

      <section className="mt-[24px]" aria-labelledby="recommendation-limitations-title">
        <h3
          id="recommendation-limitations-title"
          className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted"
        >
          Ограничения · {recommendation.limitations.length}
        </h3>
        {recommendation.limitations.length === 0 ? (
          <p className="mt-[10px] text-small text-ink-secondary">Ограничений не обнаружено.</p>
        ) : (
          <ul className="mt-[10px] list-inside list-disc space-y-[6px] text-small text-ink-secondary">
            {recommendation.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );

  // Карточка рекомендации обрезает overflow ради стеклянной маски. Детали
  // должны жить поверх всего полотна, иначе при раскрытии они остаются в
  // пределах 288 px карточки и становятся недоступны.
  const canvas = document.querySelector('.app-canvas');
  return canvas === null ? modal : createPortal(modal, canvas);
}
