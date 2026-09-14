import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';

import type { MapProjection } from './MapCanvas';

interface MapProjectionToggleProps {
  readonly projection: MapProjection;
  readonly onChange: (projection: MapProjection) => void;
}

/**
 * Два взгляда на один и тот же снимок: ландшафт даёт географический контекст, схема
 * показывает все маршруты и орбитальные волны разом, не отвлекая рельефом.
 */
export function MapProjectionToggle({ projection, onChange }: MapProjectionToggleProps) {
  // На полотне переключатель — мелкая плашка в углу карты. В потоке это самостоятельный
  // элемент панели над картой, и сегменты вырастают до цели касания.
  const stacked = useStacked();

  return (
    <div
      role="group"
      aria-label="Проекция 2D-карты"
      className={cx(
        'pointer-events-auto flex rounded-sm border border-line bg-surface-glass p-[3px] shadow-card',
        stacked ? 'h-[48px]' : 'h-[32px]',
      )}
    >
      {([
        ['terrain', 'Ландшафт'],
        ['scheme', 'Схема'],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={projection === value}
          onClick={() => { onChange(value); }}
          className={cx(
            'rounded-[7px] font-semibold transition-colors',
            stacked ? 'h-[40px] px-[12px] text-caption' : 'h-[24px] px-[9px] text-[10px]',
            projection === value
              ? 'bg-accent-violet text-white shadow-glow-violet'
              : 'text-ink-secondary hover:bg-surface-rowActive hover:text-ink-primary',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
