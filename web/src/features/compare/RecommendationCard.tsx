import { ArrowLeftRight, ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

import { getRecommendation } from '@/api/comparisons';
import type { ComparisonEntry, Recommendation } from '@/api/types';
import { ErrorBlock, LoadingBlock, Skeleton } from '@/components/state/States';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { useCanvasTextSize } from '@/app/use-viewport';
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import { deltaArrow, formatPoints } from '@/lib/measures';
import { formatGap, variantLetter } from '@/lib/run-format';
import { useResource } from '@/lib/use-resource';
import { publicPath } from '@/lib/public-path';
import { deltaToneClass } from './metrics';

const LEFT = 1202;
const TOP = 564;
/** Кегль чипов порядка критериев в макете. */
const CRITERION_TEXT = 10;

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
  const stacked = useStacked();
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
      className={stacked ? 'order-3 flex flex-col p-[16px]' : 'absolute h-[288px] w-[692px]'}
      style={stacked ? undefined : { left: LEFT, top: TOP }}
    >
      <p
        className={cx(
          'text-[11px] font-semibold tracking-[0.88px] text-accent-cyan',
          !stacked && 'absolute left-[27px] top-[13px]',
        )}
      >
        РЕКОМЕНДАЦИЯ · ranking_order
      </p>

      {recommendation.error !== null ? (
        // На полотне ошибка занимает колонку вывода, а не всю ширину: справа стоит талисман,
        // и кнопка «Повторить» оказывалась под ним.
        <div className={stacked ? 'mt-[8px] h-[120px]' : 'absolute left-[27px] top-[40px] h-[170px] w-[446px]'}>
          <ErrorBlock
            title="Вывод не получен"
            message={recommendation.error}
            onRetry={recommendation.reload}
            compact
          />
        </div>
      ) : recommendation.data === null ? (
        <LoadingBlock label="Загрузка рекомендации">
          <div className={stacked ? 'mt-[8px] space-y-[12px]' : 'absolute inset-x-[27px] top-[40px] space-y-[12px]'}>
            <Skeleton className={stacked ? 'h-[28px] w-[70%]' : 'h-[28px] w-[300px]'} />
            <Skeleton className={stacked ? 'h-[16px] w-full' : 'h-[16px] w-[420px]'} />
            <Skeleton className={stacked ? 'h-[96px] w-full' : 'h-[96px] w-[440px]'} />
          </div>
        </LoadingBlock>
      ) : (
        <>
          <Verdict
            stacked={stacked}
            recommendation={recommendation.data}
            winnerTitle={winner?.variant_title ?? '—'}
            winnerLetter={variantLetter(entries.findIndex((entry) => entry.run_id === winner?.run_id))}
            winnerIsBase={winnerIsBase}
            onOpenDetails={() => { setDetailsOpen(true); }}
          />
          {detailsOpen && (
            <RecommendationDetailsModal
              stacked={stacked}
              recommendation={recommendation.data}
              onClose={() => { setDetailsOpen(false); }}
            />
          )}
        </>
      )}

      <img
        src={publicPath('assets/mascot-recommendation.png')}
        alt=""
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute object-contain',
          // В потоке талисман уходит в угол к короткой подписи «Рекомендация»: рядом с
          // выводом в узкой колонке он заслонял бы текст.
          stacked ? 'right-[10px] top-[4px] h-[52px] w-[78px]' : 'left-[485px] top-[87px] h-[120px] w-[180px]',
        )}
      />

      {/*
        Обе кнопки одной высоты и одной ширины: «Поменять местами» в 220 пикселях
        ломалось на две строки и выпадало из своих 50 по высоте.
      */}
      <div
        className={cx(
          'flex items-stretch',
          stacked
            ? 'mt-[16px] flex-col gap-[8px]'
            : 'absolute inset-x-[27px] top-[223px] h-[50px] gap-[11px]',
        )}
      >
        <button
          type="button"
          onClick={() => { onApply(winnerIsBase ? base.variant_id : candidate.variant_id); }}
          className={cx(
            'flex items-center justify-center gap-3 whitespace-nowrap',
            stacked ? 'h-[50px] text-title-m' : 'w-[300px] shrink-0 text-[22px]',
            'rounded-lg bg-accent-violet font-semibold text-ink-onAccent shadow-glow-violet',
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
            'flex items-center justify-center gap-3 whitespace-nowrap',
            stacked ? 'h-[50px] text-title-m' : 'w-[300px] shrink-0 text-[22px]',
            'rounded-lg border border-line bg-surface-input font-semibold text-ink-primary',
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
  stacked,
  recommendation,
  winnerTitle,
  winnerLetter,
  winnerIsBase,
  onOpenDetails,
}: {
  stacked: boolean;
  recommendation: Recommendation;
  winnerTitle: string;
  winnerLetter: string;
  winnerIsBase: boolean;
  onOpenDetails: () => void;
}) {
  const availabilityDelta = recommendation.deltas['min_client_availability'];
  // Нулевая дельта — «не изменился», а не «выше на 0.00 п.п.»: иначе вывод обещает
  // улучшение, которого нет.
  const change =
    availabilityDelta === undefined
      ? ''
      : availabilityDelta === 0
        ? ' минимум доступности не изменился.'
        : ` минимум ${availabilityDelta > 0 ? 'выше' : 'ниже'} на ${formatPoints(availabilityDelta)}.`;
  const criteria = recommendation.ranking_order.map(
    (criterion, index) => `${index + 1}. ${CRITERION_TITLES[criterion] ?? criterion}`,
  );
  // Колонка вывода — 184 пикселя макета. На ноутбуке подросший текст раскладывает чипы
  // в три ряда вместо двух, и кнопка «Подробнее» уходила под кнопки карточки. Поэтому
  // там виден один ряд — старшие критерии, — а весь порядок остаётся в подсказке и в
  // окне деталей.
  const textSize = useCanvasTextSize();
  const criteriaClamped = !stacked && textSize(CRITERION_TEXT) > CRITERION_TEXT;
  const summary = winnerIsBase
    ? `База остаётся лучшей:${change} ${recommendation.target_reached ? 'Цель достигнута.' : 'Цель ещё не достигнута.'}`
    : `${winnerTitle} — лучший вариант:${change} ${recommendation.target_reached ? 'Цель достигнута.' : 'Цель ещё не достигнута.'}`;

  return (
    /* Длинные списки открываются явно в окне деталей, а не скрываются за прокруткой
       небольшой карточки рекомендации. */
    <div className={cx('flex flex-col', stacked ? 'mt-[6px]' : 'absolute left-[27px] top-[31px] h-[184px] w-[446px]')}>
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
      <ol
        className={cx('mt-[5px] flex shrink-0 flex-wrap gap-[5px] text-[10px]', criteriaClamped && 'overflow-hidden')}
        // Ряд чипа — строка кегля чипа и его поля по 2 пикселя.
        style={criteriaClamped ? { maxHeight: 'calc(1.5em + 4px)' } : undefined}
        title={criteriaClamped ? criteria.join(', ') : undefined}
      >
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
        className={cx(
          'mt-[10px] flex w-fit items-center rounded-sm border border-line bg-surface-input px-[12px] text-left text-[12px] font-semibold text-ink-primary transition-colors hover:border-line-strong',
          stacked ? 'min-h-[40px] py-[6px]' : 'h-[34px]',
        )}
      >
        Подробнее: {recommendation.per_client.length} клиентов
        {recommendation.limitations.length > 0 && ` · ${recommendation.limitations.length} ограничений`}
      </button>
    </div>
  );
}

function RecommendationDetailsModal({
  stacked,
  recommendation,
  onClose,
}: {
  stacked: boolean;
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
      <section aria-labelledby="recommendation-criteria-title">
        <h3
          id="recommendation-criteria-title"
          className="text-micro font-semibold uppercase tracking-[0.8px] text-ink-muted"
        >
          Порядок критериев
        </h3>
        <ol className="mt-[10px] flex flex-wrap gap-[6px]">
          {recommendation.ranking_order.map((criterion, index) => (
            <li
              key={criterion}
              className="rounded-sm bg-surface-chip px-[9px] py-[3px] text-caption text-ink-secondary"
            >
              {index + 1}. {CRITERION_TITLES[criterion] ?? criterion}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-[24px]" aria-labelledby="recommendation-clients-title">
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
                className={cx(
                  'grid gap-[16px] py-[10px] text-small',
                  stacked
                    ? 'grid-cols-1 gap-y-[2px] md:grid-cols-3'
                    : 'grid-cols-[minmax(96px,1fr)_minmax(150px,1fr)_minmax(190px,1fr)]',
                )}
              >
                <span className="truncate font-semibold text-ink-primary" title={client.client_id}>
                  {client.client_id}
                </span>
                <span
                  className={deltaToneClass(client.availability_delta, 'up')}
                  data-numeric
                >
                  {deltaArrow(client.availability_delta)} {formatPoints(client.availability_delta)} доступность
                </span>
                <span
                  className={deltaToneClass(client.max_gap_delta_s, 'down')}
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
  if (stacked) {
    return modal;
  }
  const canvas = document.querySelector('.app-canvas');
  return canvas === null ? modal : createPortal(modal, canvas);
}
