import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Compass, RotateCcw } from 'lucide-react';
import type { ComponentRef, ReactNode } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';

import type { Plane } from '@/api/types';
import type { SatelliteAction } from '@/map/MapCanvas';
import type { MapHit, MapLayers, MapModel } from '@/map/model';
import { readPalette } from '@/map/palette';
import { useTokenColors } from '@/theme/use-token-colors';
import { ContextMenu } from './ContextMenu';
import { Scene } from './Scene';
import { useGlobeTextures } from './textures';
import type { GlobeHit } from './types';
import { isWebglAvailable } from './webgl';

/** Состояние камеры для синхронизации двух глобусов в режиме «Рядом» (`OutagesPage`). */
export interface OrbitState {
  readonly azimuth: number;
  readonly polar: number;
  readonly distance: number;
}

const DEFAULT_ORBIT: OrbitState = {
  azimuth: THREE.MathUtils.degToRad(-30),
  polar: THREE.MathUtils.degToRad(55),
  distance: 2.8,
};
const NORTH_POLAR = THREE.MathUtils.degToRad(8);
const MIN_DISTANCE = 1.25;
const MAX_DISTANCE = 6;

export interface Globe3DProps {
  readonly model: MapModel;
  readonly layers: MapLayers;
  /** Плоскости сценария — нужны только 3D-режиму для колец орбит (`OrbitPlanes.tsx`). */
  readonly planes: readonly Plane[];
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
  readonly width: number;
  readonly height: number;
  readonly onSelectSite: (siteId: string) => void;
  readonly satelliteActions: (satelliteId: string) => readonly SatelliteAction[];
  readonly renderTooltip: (hit: MapHit) => ReactNode;
  /** Общая камера для второго глобуса в режиме «Рядом»; без неё каждый вращается сам по себе. */
  readonly orbit?: OrbitState | null | undefined;
  readonly onOrbitChange?: ((state: OrbitState) => void) | undefined;
  /** WebGL недоступен на этом устройстве — экран обязан молча вернуться в 2D. */
  readonly onUnavailable?: (() => void) | undefined;
}

/**
 * 3D-глобус как альтернативный режим карты (`docs/18_GLOBE_3D.md`). Принимает тот же снимок
 * сети, слои и колбэки выбора, что 2D-карта (`web/src/map/MapCanvas.tsx`), плюс параметры
 * орбиты сценария, которых у 2D-модели нет и не должно быть.
 */
export function Globe3D({
  model,
  layers,
  planes,
  inclinationDeg,
  altitudeKm,
  width,
  height,
  onSelectSite,
  satelliteActions,
  renderTooltip,
  orbit,
  onOrbitChange,
  onUnavailable,
}: Globe3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<CameraRigHandle>(null);

  const [available] = useState(isWebglAvailable);
  const { status, textures } = useGlobeTextures();
  const [hover, setHover] = useState<GlobeHit | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const readToken = useTokenColors();
  const palette = useMemo(() => readPalette(readToken), [readToken]);
  const dpr = useCanvasDpr();

  useEffect(() => {
    if (!available) {
      onUnavailable?.();
    }
  }, [available, onUnavailable]);

  const toLocal = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return { x: clientX, y: clientY };
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  if (!available) {
    return (
      <div
        className="flex items-center justify-center rounded-sm border border-line-subtle bg-surface-sunken text-center"
        style={{ width, height }}
      >
        <p className="max-w-[38ch] px-6 text-small text-ink-secondary">
          3D недоступен в этом браузере — WebGL не включён. Показана карта в 2D.
        </p>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex animate-pulse items-center justify-center rounded-sm border border-line-subtle bg-surface-sunken"
        style={{ width, height }}
      >
        <span className="sr-only">Загружаем текстуры глобуса</span>
      </div>
    );
  }

  const hoverLocal = hover === null ? null : toLocal(hover.clientX, hover.clientY);

  return (
    <div ref={containerRef} className="relative" style={{ width, height }}>
      <Canvas
        dpr={dpr}
        camera={{ fov: 32, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
        frameloop="demand"
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          // ACES при 1.12 выбеливал ледяную текстуру и съедал рельеф.
          gl.toneMappingExposure = 1.0;
        }}
        onPointerMissed={() => {
          setMenu(null);
        }}
      >
        <CameraRig ref={rigRef} orbit={orbit} onOrbitChange={onOrbitChange} />
        <Scene
          model={model}
          layers={layers}
          planes={planes}
          inclinationDeg={inclinationDeg}
          altitudeKm={altitudeKm}
          palette={palette}
          textures={textures}
          hoveredId={hover?.id ?? null}
          onHover={setHover}
          onSelectSatellite={(hit) => {
            const local = toLocal(hit.clientX, hit.clientY);
            setMenu({ id: hit.id, x: local.x, y: local.y });
          }}
          onSelectSite={onSelectSite}
        />
      </Canvas>

      <div className="pointer-events-none absolute right-[14px] top-[10px] flex flex-col items-end gap-[6px]">
        <div className="pointer-events-auto flex gap-[6px]">
          <button
            type="button"
            title="Камера над северным полюсом"
            onClick={() => {
              rigRef.current?.north();
            }}
            className="flex size-[30px] items-center justify-center rounded-sm border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:text-ink-primary"
          >
            <Compass aria-hidden="true" className="size-[16px]" />
          </button>
          <button
            type="button"
            title="Сбросить камеру"
            onClick={() => {
              rigRef.current?.reset();
            }}
            className="flex size-[30px] items-center justify-center rounded-sm border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:text-ink-primary"
          >
            <RotateCcw aria-hidden="true" className="size-[16px]" />
          </button>
        </div>
        <p className="pointer-events-none rounded-sm border border-line-subtle bg-surface-sunken px-[8px] py-[3px] text-micro text-ink-muted">
          ЛКМ — вращение · колесо — зум
        </p>
      </div>

      {hover !== null && hoverLocal !== null && menu === null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 w-[246px] rounded-sm border border-line bg-surface-raised px-[14px] py-[10px] shadow-card"
          style={{
            left: Math.min(Math.max(hoverLocal.x + 16, 0), Math.max(width - 246, 0)),
            top: Math.min(Math.max(hoverLocal.y - 12, 0), Math.max(height - 96, 0)),
          }}
        >
          {renderTooltip({ kind: hover.kind, id: hover.id, x: hoverLocal.x, y: hoverLocal.y })}
        </div>
      )}

      {menu !== null && (
        <ContextMenu
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

interface CameraRigHandle {
  readonly north: () => void;
  readonly reset: () => void;
}

interface CameraRigProps {
  readonly orbit?: OrbitState | null | undefined;
  readonly onOrbitChange?: ((state: OrbitState) => void) | undefined;
}

type OrbitControlsInstance = ComponentRef<typeof OrbitControls>;

function applySpherical(controls: OrbitControlsInstance, state: OrbitState): void {
  const spherical = new THREE.Spherical(state.distance, state.polar, state.azimuth);
  controls.object.position.setFromSpherical(spherical).add(controls.target);
  controls.update();
}

function readSpherical(controls: OrbitControlsInstance): OrbitState {
  const offset = controls.object.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  return { azimuth: spherical.theta, polar: spherical.phi, distance: spherical.radius };
}

/**
 * `OrbitControls` живёт внутри `<Canvas>` (нужен доступ к камере и к `invalidate` для
 * `frameloop="demand"`), а кнопки «Север»/«Сброс» — снаружи, в обычном DOM. Мост между ними —
 * императивный `ref` с двумя методами, а не пропы: нажатие кнопки не должно быть состоянием
 * React, дергающим лишний рендер сцены.
 */
const CameraRig = forwardRef<CameraRigHandle, CameraRigProps>(function CameraRig({ orbit, onOrbitChange }, ref) {
  const controlsRef = useRef<OrbitControlsInstance | null>(null);
  const lastSynced = useRef<OrbitState>(DEFAULT_ORBIT);
  const { invalidate } = useThree();

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (controls === null) {
      return;
    }
    // `useLayoutEffect`, а не `useEffect`: камера обязана встать на место до первой
    // отрисовки кадра, иначе на долю секунды мелькнёт дефолтный вид three.js.
    applySpherical(controls, orbit ?? DEFAULT_ORBIT);
    invalidate();
    // Стартовая точка обзора выставляется один раз при монтировании инструмента камеры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (orbit === undefined || orbit === null) {
      return;
    }
    const controls = controlsRef.current;
    if (controls === null) {
      return;
    }
    const last = lastSynced.current;
    if (last.azimuth === orbit.azimuth && last.polar === orbit.polar && last.distance === orbit.distance) {
      // Это эхо нашего же последнего сообщения наружу — переприменять незачем.
      return;
    }
    applySpherical(controls, orbit);
    lastSynced.current = orbit;
    invalidate();
  }, [orbit, invalidate]);

  useImperativeHandle(ref, () => ({
    north: () => {
      const controls = controlsRef.current;
      if (controls === null) {
        return;
      }
      const current = readSpherical(controls);
      const next: OrbitState = { ...current, polar: NORTH_POLAR };
      applySpherical(controls, next);
      lastSynced.current = next;
      onOrbitChange?.(next);
      invalidate();
    },
    reset: () => {
      const controls = controlsRef.current;
      if (controls === null) {
        return;
      }
      applySpherical(controls, DEFAULT_ORBIT);
      lastSynced.current = DEFAULT_ORBIT;
      onOrbitChange?.(DEFAULT_ORBIT);
      invalidate();
    },
  }), [onOrbitChange, invalidate]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      onChange={() => {
        const controls = controlsRef.current;
        if (controls === null) {
          return;
        }
        const state = readSpherical(controls);
        lastSynced.current = state;
        onOrbitChange?.(state);
      }}
    />
  );
});

/**
 * DPR канваса учитывает и плотность пикселей экрана, и масштаб полотна макета
 * (`--canvas-scale`, `app/use-canvas-scale.ts`) — тем же способом, что `MapCanvas.tsx`
 * считает `dpr` для 2D: без этого на уменьшенном окне глобус либо крупнее, чем нужно, либо
 * размыт.
 */
function useCanvasDpr(): [number, number] {
  const read = (): number => {
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--canvas-scale'));
    return Math.min(3, Math.max(1, window.devicePixelRatio * (Number.isFinite(scale) ? scale : 1)));
  };
  const [value, setValue] = useState(read);

  useEffect(() => {
    const apply = (): void => {
      setValue(read());
    };
    window.addEventListener('resize', apply);
    const observer = new ResizeObserver(apply);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', apply);
      observer.disconnect();
    };
  }, []);

  return [1, value];
}

export default Globe3D;
