import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import type { MapMode } from './map-mode';

interface MapModeToggleProps {
  readonly mode: MapMode;
  readonly onChange: (mode: MapMode) => void;
}

/** Смещение сегмента от угла контейнера — координаты узла макета `168:1378`. */
const SEGMENT_OFFSET: Record<MapMode, number> = { '2d': 3, '3d': 58 };
/** В потоке сегмент дорастает до 40 пикселей — минимальной цели касания. */
const STACKED_SEGMENT_OFFSET: Record<MapMode, number> = { '2d': 3, '3d': 63 };

/**
 * Переключатель «2D / 3D» в углу слота карты (`docs/18_GLOBE_3D.md`), 118×40 по узлу
 * макета `168:1378`. Не тянет за собой three.js: сам компонент ничего не знает о
 * `Globe3D`, поэтому его можно держать в обычном бандле, а тяжёлый 3D-модуль грузить
 * только после переключения (`React.lazy` на стороне экрана, см.
 * `NetworkPage.tsx`/`OutagesPage.tsx`).
 */
export function MapModeToggle({ mode, onChange }: MapModeToggleProps) {
  const stacked = useStacked();
  const offsets = stacked ? STACKED_SEGMENT_OFFSET : SEGMENT_OFFSET;

  return (
    <div
      role="group"
      aria-label="Режим карты"
      className={cx(
        'pointer-events-auto relative shrink-0 rounded-sm border border-line bg-surface-glass shadow-card',
        stacked ? 'h-[48px] w-[124px]' : 'h-[40px] w-[118px]',
      )}
    >
      {(['2d', '3d'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => {
            onChange(value);
          }}
          style={{ left: offsets[value], top: 3 }}
          className={cx(
            'absolute rounded-[9px] text-small font-semibold uppercase tracking-[0.4px] transition-colors duration-150 focus-visible:outline-offset-[-2px]',
            stacked ? 'h-[40px] w-[56px]' : 'h-[32px] w-[53px]',
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
