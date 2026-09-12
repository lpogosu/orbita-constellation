import { ArrowRight } from 'lucide-react';

import type { LineageEdge, LineageGraph } from '@/api/types';
import { EmptyState } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
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
 */
export function LineageCard({ lineage, labelOf }: LineageCardProps) {
  return (
    <Card
      sceneX={LEFT}
      sceneY={TOP}
      className="absolute left-[1299px] top-[214px] h-[410px] w-[596px]"
    >
      <h2 className="absolute left-[23px] top-[17px] text-title-m font-semibold text-ink-primary">
        Происхождение вариантов
      </h2>
      <p className="absolute left-[23px] top-[45px] font-mono text-[11px] text-ink-muted">
        diff_from_parent
      </p>

      <div className="absolute left-[23px] top-[75px] h-[314px] w-[550px]">
        {lineage.edges.length === 0 && (
          <EmptyState
            title="Потомков ещё нет"
            hint="В проекте только исходный вариант. Он появится здесь родителем, как только вы сохраните изменённый сценарий вариантом."
          />
        )}

        {lineage.edges.length > 0 && (
          <ul className="scroll-area h-full w-[556px] space-y-[8px]">
            {lineage.edges.map((edge) => (
              <li
                key={`${edge.parent_variant_id}-${edge.child_variant_id}`}
                className="rounded-[10px] border border-line bg-surface-sunken px-[12px] py-[8px]"
              >
                <p className="flex items-center gap-[8px] text-[13px] font-semibold text-ink-primary">
                  <span className="truncate">
                    {labelOf(edge.parent_variant_id) ?? DASH}
                  </span>
                  <ArrowRight aria-hidden="true" className="size-[14px] shrink-0 text-ink-muted" />
                  <span className="truncate">{labelOf(edge.child_variant_id) ?? DASH}</span>
                  <span className="ml-auto shrink-0 text-[13px] font-semibold text-ink-primary" data-numeric>
                    {edge.delta_min_availability == null
                      ? DASH
                      : `${edge.delta_min_availability > 0 ? '+' : ''}${formatShare(edge.delta_min_availability)}`}
                  </span>
                </p>
                <p className="mt-[4px] font-mono text-[11px] leading-[16px] text-ink-secondary">
                  {diffText(edge)}
                </p>
              </li>
            ))}
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
