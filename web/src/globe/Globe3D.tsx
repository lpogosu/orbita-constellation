import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RotateCcw } from 'lucide-react';
import type { ComponentRef, ReactNode } from 'react';
import {
  forwardRef,
  memo,
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
import { useStacked } from '@/app/viewport-mode';
import { cx } from '@/lib/cx';
import type { SatelliteAction } from '@/map/MapCanvas';
import type { MapHit, MapLayers, MapModel } from '@/map/model';
import { readPalette } from '@/map/palette';
import { useTokenColors } from '@/theme/use-token-colors';
import { EARTH_RADIUS_KM } from '@/map/projection';
import type { Hemisphere } from '@/map/projection';
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

/** Ракурс по умолчанию; дистанцию подбирает `fitDistance` под размер области. */
const DEFAULT_ANGLES = {
  azimuth: THREE.MathUtils.degToRad(-30),
  polar: THREE.MathUtils.degToRad(55),
} as const;
const CAMERA_FOV_DEG = 32;
/**
 * Половина спрайта аппарата в радиусах Земли (`Satellites.tsx`: 0.108 × 1.35 / 2): на
 * столько аппараты выступают за кольцо орбиты, и в кадр должны попасть и они.
 */
const SATELLITE_SPRITE_RADIUS = 0.075;
/** Поле вокруг планеты: без него кольца орбит касаются края области. */
const FIT_MARGIN = 1.08;
/** Полярный угол камеры почти над полюсом: 0 — строго над ним, чуть отступаем, чтобы
 * не терять ориентацию при `enableDamping`. Южный — зеркальное значение от другого полюса. */
const NORTH_POLAR = THREE.MathUtils.degToRad(8);
const SOUTH_POLAR = THREE.MathUtils.degToRad(180 - 8);
const MIN_DISTANCE = 1.25;
/** Отъехать можно заметно дальше стартового кадра, но не до точки на горизонте. */
const MAX_DISTANCE_FACTOR = 1.6;

/**
 * Дистанция, с которой Земля вместе с орбитами целиком входит в кадр.
 *
 * Сфера радиуса R видна целиком, если d ≥ R / sin(половина угла обзора). Вертикальный угол
 * задан камерой, горизонтальный зависит от пропорций области: в узкой области телефона
 * планету ограничивает ширина, а не высота, и считать только по вертикали нельзя.
 */
function fitDistance(aspect: number, altitudeKm: number): number {
  const radius = 1 + Math.max(altitudeKm, 0) / EARTH_RADIUS_KM + SATELLITE_SPRITE_RADIUS;
  const halfVertical = THREE.MathUtils.degToRad(CAMERA_FOV_DEG / 2);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * (aspect > 0 ? aspect : 1));
  return (radius / Math.sin(Math.min(halfVertical, halfHorizontal))) * FIT_MARGIN;
}

export interface Globe3DProps {
  readonly model: MapModel;
  readonly layers: MapLayers;
  /** Плоскости сценария — нужны только 3D-режиму для колец орбит (`OrbitPlanes.tsx`). */
  readonly planes: readonly Plane[];
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
  readonly earthAngle0Deg: number;
  /** Общий с 2D-картой выбор полюса (`MapLayersBar`): в 3D это точка обзора камеры, а не
   * перестроение сцены — сам глобус и аппараты остаются на месте. */
  readonly hemisphere: Hemisphere;
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
  /**
   * Сколько пикселей сверху занимают плашки экрана поверх области (отсчёт, «2D/3D»).
   * Кнопка сброса камеры встаёт под ними; если экран вынес плашки из области, здесь 0.
   */
  readonly overlayTop?: number | undefined;
}

/**
 * 3D-глобус как альтернативный режим карты (`docs/18_GLOBE_3D.md`). Принимает тот же снимок
 * сети, слои и колбэки выбора, что 2D-карта (`web/src/map/MapCanvas.tsx`), плюс параметры
 * орбиты сценария, которых у 2D-модели нет и не должно быть.
 */
function Globe3DView({
  model,
  layers,
  planes,
  inclinationDeg,
  altitudeKm,
  earthAngle0Deg,
  hemisphere,
  width,
  height,
  onSelectSite,
  satelliteActions,
  renderTooltip,
  orbit,
  onOrbitChange,
  onUnavailable,
  overlayTop = 48,
}: Globe3DProps) {
  const stacked = useStacked();
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

  // Глобус в прокручиваемой странице не должен становиться ловушкой. Колесо без Ctrl
  // перехватывается на погружении, раньше обработчика зума `OrbitControls`, и уходит
  // странице; с Ctrl (щипок на тачпаде) оно по-прежнему приближает глобус.
  useEffect(() => {
    const container = containerRef.current;
    if (!stacked || container === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) {
        event.stopPropagation();
      }
    };
    container.addEventListener('wheel', onWheel, { capture: true });
    return () => {
      container.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [stacked, status]);

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
    <div
      ref={containerRef}
      className={cx(
        'relative',
        // `OrbitControls` ставит своему элементу `touch-action: none` строкой стиля и
        // переставляет при переподключении, поэтому перебивается только `!important`.
        // `pan-y` отдаёт вертикальный жест пальцем прокрутке страницы, а горизонтальный
        // сдвиг и щипок остаются глобусу.
        stacked && '[&_canvas]:![touch-action:pan-y] [&_div]:![touch-action:pan-y]',
      )}
      style={{ width, height }}
    >
      <Canvas
        dpr={dpr}
        camera={{ fov: CAMERA_FOV_DEG, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
        frameloop="demand"
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          // При большей экспозиции ACES выбеливает льды и облака; 0.88 оставляет
          // читаемыми фактуру рельефа и тёмные участки дневной текстуры.
          gl.toneMappingExposure = 0.88;
        }}
        onPointerMissed={() => {
          setMenu(null);
        }}
      >
        <CameraRig
          ref={rigRef}
          hemisphere={hemisphere}
          altitudeKm={altitudeKm}
          orbit={orbit}
          onOrbitChange={onOrbitChange}
        />
        <Scene
          model={model}
          layers={layers}
          planes={planes}
          inclinationDeg={inclinationDeg}
          altitudeKm={altitudeKm}
          earthAngle0Deg={earthAngle0Deg}
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

      {/* Ниже переключателя «2D/3D» (тот же угол, `right-14 top-10`, `MapModeToggle`
          в родительском экране): иначе плашки перекрываются (`docs/18_GLOBE_3D.md`).
          Точку обзора «Север/Юг» задаёт общий с 2D-картой переключатель полушария —
          здесь остаётся только сброс камеры к дефолтному ракурсу. */}
      <div
        className="pointer-events-none absolute right-[14px] flex flex-col items-end gap-[6px]"
        style={{ top: overlayTop + 10 }}
      >
        <div className="pointer-events-auto flex gap-[6px]">
          <button
            type="button"
            title="Сбросить камеру"
            aria-label="Сбросить камеру"
            onClick={() => {
              rigRef.current?.reset();
            }}
            className={cx(
              'flex items-center justify-center rounded-sm border border-line bg-surface-raised text-ink-secondary transition-colors duration-150 hover:text-ink-primary',
              stacked ? 'size-[40px]' : 'size-[30px]',
            )}
          >
            <RotateCcw aria-hidden="true" className="size-[16px]" />
          </button>
        </div>
        {!stacked && (
          <p className="pointer-events-none rounded-sm border border-line-subtle bg-surface-sunken px-[8px] py-[3px] text-micro text-ink-muted">
            ЛКМ — вращение · колесо — зум
          </p>
        )}
      </div>
      {/* В потоке планета начинается от верхнего края области, и подсказка под кнопкой
          закрывала бы её; внизу по центру она ложится на поле вокруг орбит. */}
      {stacked && (
        <p className="pointer-events-none absolute bottom-[8px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-line-subtle bg-surface-sunken px-[8px] py-[3px] text-micro text-ink-muted">
          Сдвиг вбок — вращение · щипок — зум
        </p>
      )}

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

// SSE присылает частые обновления только прогресса расчёта. Пока снимок и
// параметры сцены не менялись, не отдаём Canvas на повторную reconciliation:
// иначе тяжёлая WebGL-сцена визуально "дребезжит" на каждом проценте.
export const Globe3D = memo(Globe3DView);

interface CameraRigHandle {
  readonly reset: () => void;
}

interface CameraRigProps {
  readonly hemisphere: Hemisphere;
  readonly altitudeKm: number;
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
 * `frameloop="demand"`), а кнопка «Сброс» — снаружи, в обычном DOM. Мост между ними —
 * императивный `ref`, а не проп: нажатие кнопки не должно быть состоянием React, дергающим
 * лишний рендер сцены. Смену полюса, в отличие от сброса, вызывает не кнопка здесь, а проп
 * `hemisphere` — им управляет тот же переключатель, что и 2D-картой.
 */
const CameraRig = forwardRef<CameraRigHandle, CameraRigProps>(function CameraRig(
  { hemisphere, altitudeKm, orbit, onOrbitChange },
  ref,
) {
  const controlsRef = useRef<OrbitControlsInstance | null>(null);
  const { invalidate, size } = useThree();
  const fit = fitDistance(size.width / Math.max(size.height, 1), altitudeKm);
  const defaultOrbit = useMemo<OrbitState>(() => ({ ...DEFAULT_ANGLES, distance: fit }), [fit]);
  const lastSynced = useRef<OrbitState>(defaultOrbit);
  // Пока пользователь не приближал и не отдалял камеру, она следует за размером области:
  // поворот телефона или смена сетки страницы не должны обрезать планету.
  const zoomTouched = useRef(false);
  // Полюс, к которому сейчас едет камера, или `null`, если переход уже завершён (или ещё
  // не начинался). Первое значение полушария не анимируем — стартовый вид задаёт
  // `orbit`/`DEFAULT_ORBIT`, а не молчаливый прыжок к полюсу при открытии 3D.
  const polarTarget = useRef<number | null>(null);
  const mountedHemisphere = useRef(hemisphere);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (controls === null) {
      return;
    }
    // `useLayoutEffect`, а не `useEffect`: камера обязана встать на место до первой
    // отрисовки кадра, иначе на долю секунды мелькнёт дефолтный вид three.js.
    applySpherical(controls, orbit ?? defaultOrbit);
    invalidate();
    // Стартовая точка обзора выставляется один раз при монтировании инструмента камеры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null || zoomTouched.current) {
      return;
    }
    const current = readSpherical(controls);
    if (Math.abs(current.distance - fit) < 1e-3) {
      return;
    }
    const next = { ...current, distance: fit };
    // Запоминается до применения: `update()` синхронно зовёт `onChange`, и без этого
    // подгонка под размер выглядела бы как зум пользователя.
    lastSynced.current = next;
    applySpherical(controls, next);
    onOrbitChange?.(next);
    invalidate();
  }, [fit, invalidate, onOrbitChange]);


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
    lastSynced.current = orbit;
    applySpherical(controls, orbit);
    invalidate();
  }, [orbit, invalidate]);

  // Смена полюса — точка обзора камеры, а не перестроение сцены: геометрия и позиции
  // аппаратов остаются как есть, меняется только откуда на них смотрят (`14_SCREENS.md`).
  useEffect(() => {
    if (mountedHemisphere.current === hemisphere) {
      return;
    }
    mountedHemisphere.current = hemisphere;
    polarTarget.current = hemisphere === 'north' ? NORTH_POLAR : SOUTH_POLAR;
    invalidate();
  }, [hemisphere, invalidate]);

  // Плавный переход к цели: доля разницы за кадр даёт мягкое затухающее движение вместо
  // мгновенного прыжка, и не требует отдельной библиотеки анимации ради одного угла.
  useFrame(() => {
    const target = polarTarget.current;
    const controls = controlsRef.current;
    if (target === null || controls === null) {
      return;
    }
    const current = readSpherical(controls);
    const diff = target - current.polar;
    if (Math.abs(diff) < 0.001) {
      polarTarget.current = null;
      return;
    }
    const next: OrbitState = { ...current, polar: current.polar + diff * 0.12 };
    applySpherical(controls, next);
    lastSynced.current = next;
    onOrbitChange?.(next);
    invalidate();
  });

  useImperativeHandle(ref, () => ({
    reset: () => {
      const controls = controlsRef.current;
      if (controls === null) {
        return;
      }
      polarTarget.current = null;
      lastSynced.current = defaultOrbit;
      applySpherical(controls, defaultOrbit);
      zoomTouched.current = false;
      onOrbitChange?.(defaultOrbit);
      invalidate();
    },
  }), [onOrbitChange, invalidate, defaultOrbit]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      minDistance={MIN_DISTANCE}
      maxDistance={fit * MAX_DISTANCE_FACTOR}
      onChange={() => {
        const controls = controlsRef.current;
        if (controls === null) {
          return;
        }
        const state = readSpherical(controls);
        if (Math.abs(state.distance - lastSynced.current.distance) > 1e-3) {
          zoomTouched.current = true;
        }
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
