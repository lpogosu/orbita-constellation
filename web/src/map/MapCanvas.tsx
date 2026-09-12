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

export type MapProjection = 'terrain' | 'scheme';

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
  readonly projection?: MapProjection;
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
  projection = 'scheme',
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
  const [zoom, setZoom] = useState(1);
  const [flatViewport, setFlatViewport] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef<{ readonly startX: number; readonly startY: number; readonly offsetX: number; readonly offsetY: number; moved: boolean } | null>(null);
  const draggedRef = useRef(false);

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

      const baseFlatWidth = width - 68;
      const baseFlatHeight = height - 174;
      const flatWidth = baseFlatWidth * flatViewport.scale;
      const flatHeight = baseFlatHeight * flatViewport.scale;
      const view: MapView = projection === 'scheme'
        ? {
            kind: 'flat',
            left: (width - flatWidth) / 2 + flatViewport.offsetX,
            top: 92 + (baseFlatHeight - flatHeight) / 2 + flatViewport.offsetY,
            width: flatWidth,
            height: flatHeight,
          }
        : {
        centerX: width / 2,
        centerY: height / 2,
        // Диск должен быть главным объектом экрана. Раньше 0.24 оставлял слишком
        // много пустого поля и маршрут превращался в россыпь мелких точек.
        radiusEquator: Math.min(width, height) * 0.29 * zoom,
        hemisphere,
        kind: 'polar',
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
  }, [model, layers, hemisphere, projection, width, height, sprites, hover, palette, zoom, flatViewport]);

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
        style={{ width, height, touchAction: 'none' }}
        className="block"
        role="img"
        aria-label="Карта группировки в полярной проекции"
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (projection === 'scheme' && drag !== null) {
            const deltaX = event.clientX - drag.startX;
            const deltaY = event.clientY - drag.startY;
            if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
              drag.moved = true;
              draggedRef.current = true;
            }
            setFlatViewport((current) => {
              const maxX = ((width - 68) * current.scale - (width - 68)) / 2;
              const maxY = ((height - 174) * current.scale - (height - 174)) / 2;
              return {
                ...current,
                offsetX: Math.min(maxX, Math.max(-maxX, drag.offsetX + deltaX)),
                offsetY: Math.min(maxY, Math.max(-maxY, drag.offsetY + deltaY)),
              };
            });
            setHover(null);
            return;
          }
          setHover(locate(event));
        }}
        onPointerLeave={() => {
          setHover(null);
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (projection === 'scheme') {
            const box = event.currentTarget.getBoundingClientRect();
            const pointerX = ((event.clientX - box.left) / box.width) * width;
            const pointerY = ((event.clientY - box.top) / box.height) * height;
            setFlatViewport((current) => {
              const scale = Math.min(2.8, Math.max(1, current.scale * (event.deltaY < 0 ? 1.16 : 0.86)));
              const oldWidth = (width - 68) * current.scale;
              const oldHeight = (height - 174) * current.scale;
              const oldLeft = (width - oldWidth) / 2 + current.offsetX;
              const oldTop = 92 + ((height - 174) - oldHeight) / 2 + current.offsetY;
              const nextWidth = (width - 68) * scale;
              const nextHeight = (height - 174) * scale;
              const nextOffsetX = pointerX - ((pointerX - oldLeft) / oldWidth) * nextWidth - (width - nextWidth) / 2;
              const nextOffsetY = pointerY - ((pointerY - oldTop) / oldHeight) * nextHeight - 92 - ((height - 174) - nextHeight) / 2;
              const maxX = ((width - 68) * scale - (width - 68)) / 2;
              const maxY = ((height - 174) * scale - (height - 174)) / 2;
              return {
                scale,
                offsetX: Math.min(maxX, Math.max(-maxX, nextOffsetX)),
                offsetY: Math.min(maxY, Math.max(-maxY, nextOffsetY)),
              };
            });
            return;
          }
          setZoom((current) => {
            const factor = event.deltaY < 0 ? 1.1 : 0.9;
            return Math.min(1.45, Math.max(0.72, current * factor));
          });
        }}
        onPointerDown={(event) => {
          if (projection !== 'scheme' || event.button !== 0) {
            return;
          }
          draggedRef.current = false;
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            offsetX: flatViewport.offsetX,
            offsetY: flatViewport.offsetY,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (dragRef.current !== null) {
            draggedRef.current = dragRef.current.moved;
            dragRef.current = null;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onClick={(event) => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
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
