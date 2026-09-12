import { useEffect, useState } from 'react';
import * as THREE from 'three';

/** Пути готовых текстур (`web/public/assets/`, `docs/18_GLOBE_3D.md` §5). */
const SOURCES = {
  day: '/assets/earth-natural-equirect.png',
  night: '/assets/earth-night.webp',
  clouds: '/assets/clouds.webp',
  rough: '/assets/earth-rough.png',
} as const;

type TextureKey = keyof typeof SOURCES;

export interface GlobeTextures {
  readonly day: THREE.Texture | null;
  readonly night: THREE.Texture | null;
  readonly clouds: THREE.Texture | null;
  readonly rough: THREE.Texture | null;
  /** Какие текстуры не загрузились: Земля рисуется и без них (см. `Earth.tsx`). */
  readonly failed: ReadonlySet<TextureKey>;
}

export type GlobeTextureStatus = 'loading' | 'ready';

/**
 * Грабля №2 из задания: сцена не рисуется, пока `LoadingManager` не сообщил `onLoad` —
 * до этого текстуры ещё не декодированы, и кадр случайно выходит пустым. Пока `status`
 * не `'ready'`, `Globe3D` не монтирует `<Canvas>` вовсе, а показывает состояние загрузки.
 */
export function useGlobeTextures(): { status: GlobeTextureStatus; textures: GlobeTextures } {
  const [status, setStatus] = useState<GlobeTextureStatus>('loading');
  const [textures, setTextures] = useState<GlobeTextures>({
    day: null,
    night: null,
    clouds: null,
    rough: null,
    failed: new Set<TextureKey>(),
  });

  useEffect(() => {
    let active = true;
    const manager = new THREE.LoadingManager();
    const loader = new THREE.TextureLoader(manager);
    const failed = new Set<TextureKey>();
    const loaded: Partial<Record<TextureKey, THREE.Texture>> = {};

    for (const key of Object.keys(SOURCES) as TextureKey[]) {
      const texture = loader.load(
        SOURCES[key],
        undefined,
        undefined,
        () => {
          failed.add(key);
        },
      );
      if (key !== 'rough') {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      texture.anisotropy = 8;
      texture.wrapS = THREE.RepeatWrapping;
      loaded[key] = texture;
    }

    manager.onLoad = () => {
      if (!active) {
        return;
      }
      setTextures({
        day: failed.has('day') ? null : (loaded.day ?? null),
        night: failed.has('night') ? null : (loaded.night ?? null),
        clouds: failed.has('clouds') ? null : (loaded.clouds ?? null),
        rough: failed.has('rough') ? null : (loaded.rough ?? null),
        failed: new Set(failed),
      });
      setStatus('ready');
    };

    return () => {
      active = false;
      for (const texture of Object.values(loaded)) {
        texture.dispose();
      }
    };
  }, []);

  return { status, textures };
}
