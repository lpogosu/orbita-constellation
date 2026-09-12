import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { drawScene, hitTest } from './draw';
import type { DrawResult } from './draw';
import { loadMapSprites } from './earth-layer';
import type { MapSprites } from './earth-layer';
import type { MapHit, MapLayers, MapModel } from './model';
import { readPalette } from './palette';
import { useTokenColors } from '@/theme/use-token-colors';
import type { Hemisphere, MapView } from './projection';

export interface SatelliteAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly hint?: string;
}

interface MapCanvasProps {
  readonly model: MapModel;
  readonly layers: MapLayers;
  readonly hemisphere: Hemisphere;
  readonly width: number;
  readonly height: number;
  readonly onSelectSite: (siteId: string) => void;
  readonly satelliteActions: (satelliteId: string) => readonly SatelliteAction[];
  readonly renderTooltip: (hit: MapHit) => ReactNode;
}

/**
 * Полярная карта на Canvas 2D. Кадр перерисовывается по `requestAnimationFrame` и только
 * когда изменилось состояние: снимок, слои, полушарие, выбор или курсор. Размер
 * задаётся макетом, а плотность пикселей — окном и масштабом полотна, иначе линии
 * маршрута на экране с DPR 2 выходят вдвое толще, чем нужно.
 */
export function MapCanvas({
  model,
  layers,
  hemisphere,
  width,
  height,
  onSelectSite,
  satelliteActions,
  renderTooltip,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultRef = useRef<DrawResult | null>(null);
  const frameRef = useRef(0);

  const readToken = useTokenColors();
  const palette = useMemo(() => readPalette(readToken), [readToken]);

  const [sprites, setSprites] = useState<MapSprites | null>(null);
  const [hover, setHover] = useState<MapHit | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    void loadMapSprites().then(
      (loaded) => {
        if (active) {
          setSprites(loaded);
        }
      },
      () => {
        // Карта рисуется и без картинок: аппараты станут точками цвета плоскости.
        if (active) {
          setSprites(null);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const render = (): void => {
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        return;
      }

      // Полотно макета масштабируется под окно, поэтому один CSS-пиксель карты равен
      // `scale × devicePixelRatio` пикселям устройства.
      const scale = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale'),
      );
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio * (Number.isFinite(scale) ? scale : 1)));

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const view: MapView = {
        centerX: width / 2,
        centerY: height / 2,
        // Экватор на половине радиуса карты: вторая половина отдана южному полушарию,
        // и ни один пункт не приходится обрезать по краю.
        radiusEquator: Math.min(width, height) * 0.24,
        hemisphere,
      };

      resultRef.current = drawScene(ctx, {
        model,
        view,
        layers,
        palette,
        sprites,
        hoveredId: hover?.id ?? null,
        width,
        height,
        dpr,
      });
    };

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frameRef.current);
    };
  }, [model, layers, hemisphere, width, height, sprites, hover, palette]);

  const locate = useCallback((event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const result = resultRef.current;
    if (canvas === null || result === null) {
      return null;
    }
    const box = canvas.getBoundingClientRect();
    const point = {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    };
    const found = hitTest(result, point);
    if (found === null) {
      return null;
    }
    const at = result.positions.get(found.id);
    return at === undefined ? null : { ...found, x: at.x, y: at.y };
  }, [width, height]);

  return (
    <div className="relative" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="block"
        role="img"
        aria-label="Карта группировки в полярной проекции"
        onPointerMove={(event) => {
          setHover(locate(event));
        }}
        onPointerLeave={() => {
          setHover(null);
        }}
        onClick={(event) => {
          const found = locate(event);
          if (found === null) {
            setMenu(null);
            return;
          }
          if (found.kind === 'site') {
            setMenu(null);
            onSelectSite(found.id);
            return;
          }
          setMenu({ id: found.id, x: found.x, y: found.y });
        }}
      />

      {hover !== null && menu === null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 w-[246px] rounded-sm border border-line bg-surface-raised px-[14px] py-[10px] shadow-card"
          style={{
            left: Math.min(Math.max(hover.x + 16, 0), Math.max(width - 246, 0)),
            top: Math.min(Math.max(hover.y - 12, 0), Math.max(height - 96, 0)),
          }}
        >
          {renderTooltip(hover)}
        </div>
      )}

      {menu !== null && (
        <MapMenu
          x={Math.min(menu.x + 16, Math.max(width - 232, 0))}
          y={Math.min(menu.y + 8, Math.max(height - 120, 0))}
          title={menu.id}
          actions={satelliteActions(menu.id)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function MapMenu({
  x,
  y,
  title,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  actions: readonly SatelliteAction[];
  onClose: () => void;
}) {
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
