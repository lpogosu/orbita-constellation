import { useEffect, useRef } from 'react';

import type { SatelliteAction } from '@/map/MapCanvas';

interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly actions: readonly SatelliteAction[];
  readonly onClose: () => void;
}

/**
 * Контекстное меню спутника поверх 3D-канваса — тот же контракт `SatelliteAction[]`, что у
 * 2D-карты, и та же разметка (`MapCanvas.tsx`, приватный `MapMenu`), чтобы меню не выглядело
 * пришельцем из другого экрана при переключении режима.
 */
export function ContextMenu({ x, y, title, actions, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Действия для ${title}`}
      className="absolute z-30 w-[232px] overflow-hidden rounded-sm border border-line-strong bg-surface-raised shadow-card"
      style={{ left: x, top: y }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
    >
      <p className="border-b border-line-divider px-[14px] py-[8px] text-caption font-semibold text-ink-muted">
        {title}
      </p>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          disabled={action.disabled === true}
          title={action.hint}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
          className="block w-full px-[14px] py-[10px] text-left text-small text-ink-primary transition-colors duration-150 hover:bg-surface-rowActive disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
