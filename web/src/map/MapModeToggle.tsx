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
      className="pointer-events-auto flex h-[30px] items-center gap-[3px] rounded-[9px] border border-line-subtle bg-surface-sunken/95 p-[3px] shadow-card"
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
            'h-[22px] w-[34px] rounded-[6px] text-micro font-bold uppercase tracking-[0.4px] transition-colors duration-150 focus-visible:outline-offset-[-2px]',
            mode === value
              ? 'bg-accent-blue text-white shadow-sm'
              : 'text-ink-muted hover:bg-surface-rowActive hover:text-ink-secondary',
          )}
        >
          {value.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
