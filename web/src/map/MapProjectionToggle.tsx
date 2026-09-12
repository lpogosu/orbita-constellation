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
  return (
    <div
      role="group"
      aria-label="Проекция 2D-карты"
      className="pointer-events-auto flex h-[32px] rounded-sm border border-line bg-surface-glass p-[3px] shadow-card"
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
            'h-[24px] rounded-[7px] px-[9px] text-[10px] font-semibold transition-colors',
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
