import { useMemo } from 'react';
import * as THREE from 'three';

import { LIGHT_DIRECTION } from './geo';
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
 * Земля с ночными огнями, облака отдельной сферой и атмосфера с френелем — перенесено из
 * прототипа почти дословно (грабля №1: только `MeshStandardMaterial` + `onBeforeCompile`,
 * свой `ShaderMaterial` для самой Земли не заводится, three сам делает decode → tonemap →
 * encode; атмосфера — отдельный `ShaderMaterial`, у неё нет текстур, поэтому свой шейдер
 * там уместен и не ломает цвет).
 */
export function Earth({ textures, atmosphereColorA, atmosphereColorB, fallbackColor, gridColor }: EarthProps) {
  const earthMaterial = useMemo(() => {
    if (textures.day === null) {
      // Нет и не будет: без базовой текстуры показываем ровный цвет поверхности —
      // сетка меридианов рисуется отдельной wireframe-сферой поверх (см. ниже).
      return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 1, metalness: 0.05 });
    }
    const material = new THREE.MeshStandardMaterial({
      map: textures.day,
      roughnessMap: textures.rough,
      roughness: 1,
      metalness: 0.08,
      emissiveMap: textures.night,
      color: new THREE.Color(0x9bb6df),
      emissive: textures.night === null ? new THREE.Color(0x000000) : new THREE.Color(0x355b9a),
      emissiveIntensity: 0.28,
    });
    if (textures.night !== null) {
      // Ночные огни видны только на тёмной стороне: без этой вставки эмиссивная карта
      // светилась бы одинаково и днём, смывая текстуру (грабля №1 — раскладка тонов и
      // цветового пространства остаётся стандартным `#include`, добавляется только сила
      // эмиссии по углу к свету).
      material.onBeforeCompile = (shader) => {
        shader.uniforms['uLight'] = { value: LIGHT_DIRECTION.clone() };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uLight;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             vec3 _globeL = normalize((viewMatrix * vec4(uLight, 0.0)).xyz);
             float _globeNdl = dot(normalize(vNormal), _globeL);
             totalEmissiveRadiance *= smoothstep(0.04, -0.26, _globeNdl) * 0.85;`,
          );
      };
    }
    return material;
  }, [textures.day, textures.rough, textures.night, fallbackColor]);

  const cloudMaterial = useMemo(() => {
    if (textures.clouds === null) {
      return null;
    }
    return new THREE.MeshStandardMaterial({
      map: textures.clouds,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0,
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
            gl_FragColor = vec4(c, 1.0) * i * 0.62;
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
        <sphereGeometry args={[1.075, 96, 64]} />
      </mesh>
    </group>
  );
}
