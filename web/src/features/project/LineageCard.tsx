import { ArrowRight } from 'lucide-react';

import type { LineageEdge, LineageGraph } from '@/api/types';
import { useStacked } from '@/app/viewport-mode';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { DASH, changeText, formatShare } from '@/lib/run-format';

const LEFT = 1299;
const TOP = 214;

interface LineageCardProps {
  /** Загрузку и ошибку показывает экран: источник у всех трёх карточек общий. */
  lineage: LineageGraph;
  /** Буква и название по идентификатору варианта — чтобы ребро читалось словами. */
  labelOf: (variantId: string) => string | null;
}

/**
 * Card / Происхождение вариантов (148:1217) списком, а не деревом: рёбра `lineage`
 * отвечают на единственный вопрос — «чем потомок отличается от родителя», и в списке это
 * видно без разбора отступов.
 *
 * В потоке список не прокручивается внутри карточки, а растёт вместе со страницей; на
 * планшете рёбра идут в две колонки.
 */
export function LineageCard({ lineage, labelOf }: LineageCardProps) {
  const stacked = useStacked();

  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className={
        stacked
          ? 'px-[16px] pb-[16px] pt-[16px] md:px-[20px]'
          : 'absolute left-[1299px] top-[214px] h-[410px] w-[596px]'
      }
    >
      <h2
        className={cx(
          'text-title-m font-semibold text-ink-primary',
          !stacked && 'absolute left-[23px] top-[17px]',
        )}
      >
        Происхождение вариантов
      </h2>
      <p
        className={cx(
          'font-mono text-[11px] text-ink-muted',
          !stacked && 'absolute left-[23px] top-[45px]',
        )}
      >
        diff_from_parent
      </p>

      <div
        className={stacked ? 'mt-[12px]' : 'absolute left-[23px] top-[75px] h-[314px] w-[550px]'}
      >
        {lineage.edges.length === 0 && (
          <div className={stacked ? 'min-h-[200px]' : 'contents'}>
            <EmptyState
              title="Потомков ещё нет"
              hint="В проекте только исходный вариант. Он появится здесь родителем, как только вы сохраните изменённый сценарий вариантом."
            />
          </div>
        )}

        {lineage.edges.length > 0 && (
          <ul
            className={
              stacked
                ? 'grid gap-[8px] md:grid-cols-2'
                : 'scroll-area h-full w-[556px] space-y-[8px]'
            }
          >
            {lineage.edges.map((edge) => {
              const parent = labelOf(edge.parent_variant_id) ?? DASH;
              const child = labelOf(edge.child_variant_id) ?? DASH;
              return (
                <li
                  key={`${edge.parent_variant_id}-${edge.child_variant_id}`}
                  className="min-w-0 rounded-[10px] border border-line bg-surface-sunken px-[12px] py-[8px]"
                >
                  <p className="flex items-center gap-[8px] text-[13px] font-semibold text-ink-primary">
                    <span className="truncate" title={parent}>
                      {parent}
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-[14px] shrink-0 text-ink-muted"
                    />
                    <span className="truncate" title={child}>
                      {child}
                    </span>
                    <span
                      className="ml-auto shrink-0 text-[13px] font-semibold text-ink-primary"
                      title={
                        edge.delta_min_availability == null
                          ? 'Разница худшей доступности появится, когда у родителя и потомка будут успешные расчёты'
                          : 'Изменение худшей доступности клиента относительно родителя'
                      }
                      data-numeric
                    >
                      {edge.delta_min_availability == null
                        ? DASH
                        : `${edge.delta_min_availability > 0 ? '+' : ''}${formatShare(edge.delta_min_availability)}`}
                    </span>
                  </p>
                  <p className="mt-[4px] break-words font-mono text-[11px] leading-[16px] text-ink-secondary">
                    {diffText(edge)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Две правки показываются целиком, дальше — счёт: строка не должна разрастаться. */
function diffText(edge: LineageEdge): string {
  if (edge.diff.length === 0) {
    return 'параметры не отличаются';
  }
  const shown = edge.diff.slice(0, 2).map(changeText).join('; ');
  return edge.diff.length > 2 ? `${shown}; и ещё ${String(edge.diff.length - 2)}` : shown;
}
