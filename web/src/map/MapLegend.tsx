import { X } from 'lucide-react';

import { cx } from '@/lib/cx';

interface MapLegendProps {
  readonly planeIds: readonly string[];
  readonly planeColors: readonly string[];
  /**
   * `overlay` — плашка в углу карты, как в макете. `inline` — строка под картой: на узкой
   * карте телефона угловая плашка закрывала бы треть изображения.
   */
  readonly placement?: 'overlay' | 'inline';
}

/**
 * Легенда карты в её собственном углу (узел макета `33:249`). Панель фиксированной
 * ширины с переносом: плоскости приходят из сценария, и при пяти и более рядов
 * становится два, а не строка, вылезающая за карту.
 */
export function MapLegend({ planeIds, planeColors, placement = 'overlay' }: MapLegendProps) {
  return (
    <ul
      className={cx(
        'flex flex-wrap items-center gap-x-[12px] gap-y-[6px] rounded-sm border border-line bg-surface-raised px-[12px] py-[9px]',
        placement === 'overlay'
          ? 'pointer-events-none absolute bottom-[14px] left-[14px] w-[232px]'
          : 'w-full',
      )}
    >
      {planeIds.map((planeId, index) => (
        <LegendItem
          key={planeId}
          label={planeId}
          color={planeColors[index % planeColors.length] ?? 'currentColor'}
        />
      ))}
      <LegendItem label="ISL" color="var(--map-isl)" />
      <LegendItem label="Шлюз" color="var(--map-gateway)" />
      <LegendItem label="Маршрут" color="var(--map-route)" />
      <LegendItem label="Резерв" color="var(--map-backup)" dashed />
      <LegendItem label="Отказ" color="var(--map-failed)" cross />
    </ul>
  );
}

function LegendItem({
  label,
  color,
  dashed = false,
  cross = false,
}: {
  label: string;
  color: string;
  dashed?: boolean;
  cross?: boolean;
}) {
  return (
    <li className="flex max-w-full items-center gap-[6px] text-caption font-medium text-ink-secondary">
      {cross ? (
        <X aria-hidden="true" className="size-[11px] shrink-0" style={{ color }} />
      ) : dashed ? (
        <span
          aria-hidden="true"
          className="h-0 w-[14px] shrink-0 border-t-2 border-dashed"
          style={{ borderColor: color }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="size-[8px] shrink-0 rounded-pill"
          style={{ background: color }}
        />
      )}
      <span className="truncate">{label}</span>
    </li>
  );
}
