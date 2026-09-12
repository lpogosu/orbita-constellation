import { useMemo } from 'react';
import * as THREE from 'three';

import type { GlobeTextures } from './textures';

interface EarthProps {
  readonly textures: GlobeTextures;
  /** Цвета Fresnel-свечения атмосферы — токены `--accent-blue`/`--accent-cyan` темы. */
  readonly atmosphereColorA: string;
  readonly atmosphereColorB: string;
  /** Цвет поверхности, если основная текстура не загрузилась (`--surface-sunken`-подобный). */
  readonly fallbackColor: string;
  readonly gridColor: string;
}

/**
 * Дневная фототекстура выводится напрямую, без PBR-освещения. Иначе глобальный свет,
 * ночная эмиссия и ACES по-разному окрашивают Землю в тёмной и светлой CSS-темах.
 * Атмосфера, спутники и линии остаются отдельными 3D-слоями.
 */
export function Earth({ textures, atmosphereColorA, atmosphereColorB, fallbackColor, gridColor }: EarthProps) {
  const earthMaterial = useMemo(() => {
    if (textures.day === null) {
      // Нет и не будет: без базовой текстуры показываем ровный цвет поверхности —
      // сетка меридианов рисуется отдельной wireframe-сферой поверх (см. ниже).
      return new THREE.MeshBasicMaterial({ color: fallbackColor });
    }
    return new THREE.MeshBasicMaterial({
      map: textures.day,
      // Не даём tone mapping и exposure менять пиксели исходной фотографии.
      toneMapped: false,
    });
  }, [textures.day, fallbackColor]);

  const cloudMaterial = useMemo(() => {
    if (textures.clouds === null) {
      return null;
    }
    return new THREE.MeshBasicMaterial({
      map: textures.clouds,
      transparent: true,
      // Белые облака не должны превращать полярные льды в сплошную светлую массу.
      opacity: 0.19,
      depthWrite: false,
      toneMapped: false,
    });
  }, [textures.clouds]);

  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          glowA: { value: new THREE.Color(atmosphereColorA) },
          glowB: { value: new THREE.Color(atmosphereColorB) },
        },
        vertexShader: `varying vec3 vN; varying vec3 vP;
          void main() {
            vN = normalize(normalMatrix * normal);
            vP = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `uniform vec3 glowA; uniform vec3 glowB; varying vec3 vN; varying vec3 vP;
          void main() {
            float i = pow(0.72 - dot(vN, vP), 3.4);
            i = clamp(i, 0.0, 2.0);
            vec3 c = mix(glowA, glowB, clamp(i * 0.5, 0.0, 1.0));
            // Keep the rim present without turning the globe into a neon bubble.
            gl_FragColor = vec4(c, 1.0) * i * 0.48;
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [atmosphereColorA, atmosphereColorB],
  );

  return (
    <group>
      <mesh material={earthMaterial}>
        <sphereGeometry args={[1, 192, 128]} />
      </mesh>
      {textures.day === null && (
        // Сетка меридианов и параллелей — единственный ориентир, когда текстуры нет.
        <mesh>
          <sphereGeometry args={[1.001, 24, 16]} />
          <meshBasicMaterial color={gridColor} wireframe transparent opacity={0.5} />
        </mesh>
      )}
      {cloudMaterial !== null && (
        <mesh material={cloudMaterial}>
          <sphereGeometry args={[1.006, 128, 96]} />
        </mesh>
      )}
      <mesh material={atmosphereMaterial}>
        <sphereGeometry args={[1.06, 96, 64]} />
      </mesh>
    </group>
  );
}
