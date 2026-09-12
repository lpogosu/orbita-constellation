import { cx } from '@/lib/cx';
import type { MapMode } from './map-mode';

interface MapModeToggleProps {
  readonly mode: MapMode;
  readonly onChange: (mode: MapMode) => void;
}

/** Смещение сегмента от угла контейнера — координаты узла макета `168:1378`. */
const SEGMENT_OFFSET: Record<MapMode, number> = { '2d': 3, '3d': 58 };

/**
 * Переключатель «2D / 3D» в углу слота карты (`docs/18_GLOBE_3D.md`), 118×40 по узлу
 * макета `168:1378`. Не тянет за собой three.js: сам компонент ничего не знает о
 * `Globe3D`, поэтому его можно держать в обычном бандле, а тяжёлый 3D-модуль грузить
 * только после переключения (`React.lazy` на стороне экрана, см.
 * `NetworkPage.tsx`/`OutagesPage.tsx`).
 */
export function MapModeToggle({ mode, onChange }: MapModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Режим карты"
      className="pointer-events-auto relative h-[40px] w-[118px] rounded-sm border border-line bg-surface-glass shadow-card"
    >
      {(['2d', '3d'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => {
            onChange(value);
          }}
          style={{ left: SEGMENT_OFFSET[value], top: 3 }}
          className={cx(
            'absolute h-[32px] w-[53px] rounded-[9px] text-small font-semibold uppercase tracking-[0.4px] transition-colors duration-150',
            mode === value
              ? 'bg-accent-violet text-white shadow-glow-violet'
              : 'text-ink-secondary hover:bg-surface-rowActive hover:text-ink-primary',
          )}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
