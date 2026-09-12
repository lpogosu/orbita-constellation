import { cx } from '@/lib/cx';
import type { MapMode } from './map-mode';

interface MapModeToggleProps {
  readonly mode: MapMode;
  readonly onChange: (mode: MapMode) => void;
}

/**
 * Переключатель «2D / 3D» в углу слота карты (`docs/18_GLOBE_3D.md`). Не тянет за собой
 * three.js: сам компонент ничего не знает о `Globe3D`, поэтому его можно держать в обычном
 * бандле, а тяжёлый 3D-модуль грузить только после переключения (`React.lazy` на стороне
 * экрана, см. `NetworkPage.tsx`/`OutagesPage.tsx`).
 */
export function MapModeToggle({ mode, onChange }: MapModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Режим карты"
      className="pointer-events-auto flex h-[25px] items-center gap-[1px] rounded-[8px] border border-line-subtle bg-surface-sunken p-[2px]"
    >
      {(['2d', '3d'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => {
            onChange(value);
          }}
          className={cx(
            'h-[19px] w-[30px] rounded-[6px] text-micro font-semibold uppercase tracking-[0.4px] transition-colors duration-150',
            mode === value ? 'bg-surface-chip text-ink-primary' : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
