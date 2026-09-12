import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

import type { GroundSite } from '@/api/types';
import type { MapPalette } from '@/map/palette';
import type { ComponentSplit } from '@/map/model';
import { siteScenePosition } from './geo';
import {
  GATEWAY_BASE_GEOMETRY,
  GATEWAY_DISH_GEOMETRY,
  GROUND_KNOB_GEOMETRY,
  GROUND_PIN_GEOMETRY,
  SITE_HITBOX_GEOMETRY,
} from './geometries';
import { glowTexture } from './glow-texture';
import { GATEWAY_BASE_MATERIAL, GATEWAY_DISH_MATERIAL, HITBOX_MATERIAL } from './satellite-look';
import type { ScreenHit } from './types';

interface GroundSitesProps {
  readonly sites: readonly GroundSite[];
  readonly selectedClientId: string | null;
  readonly components: ComponentSplit | null;
  readonly palette: MapPalette;
  readonly showLabels: boolean;
  readonly hoveredId: string | null;
  readonly onHover: (hit: ScreenHit | null) => void;
  readonly onSelect: (siteId: string) => void;
}

/**
 * Наземные пункты сценария: клиент — штырь с шариком, шлюз — основание с тарелкой (та же
 * геометрия, что в прототипе). Ориентация каждого пункта по нормали к поверхности через
 * кватернион из `setFromUnitVectors`, а не через Эйлеровы углы — на полюсах они вырождаются.
 */
export function GroundSites({
  sites,
  selectedClientId,
  components,
  palette,
  showLabels,
  hoveredId,
  onHover,
  onSelect,
}: GroundSitesProps) {
  const UP = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  const placed = useMemo(
    () =>
      sites.map((site) => {
        const position = siteScenePosition(site.lat_deg, site.lon_deg);
        const normal = position.clone().normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal);
        return { site, position, quaternion };
      }),
    [sites, UP],
  );

  return (
    <group>
      {placed.map(({ site, position, quaternion }) => {
        const selected = site.id === selectedClientId;
        const hovered = hoveredId === site.id;
        const outlined =
          components !== null
          && (components.clientSiteId === site.id || components.gatewaySiteIds.includes(site.id));
        const outlineColor = components !== null && components.clientSiteId === site.id
          ? palette.route
          : palette.backup;
        const glowColor = selected ? palette.clientSelected : palette.client;

        return (
          <group key={site.id} position={position} quaternion={quaternion}>
            {site.role === 'gateway' ? (
              <>
                <mesh geometry={GATEWAY_BASE_GEOMETRY} material={GATEWAY_BASE_MATERIAL} position={[0, 0.004, 0]} />
                <mesh
                  geometry={GATEWAY_DISH_GEOMETRY}
                  material={GATEWAY_DISH_MATERIAL}
                  position={[0, 0.016, 0]}
                  rotation={[0, 0, -0.5]}
                />
              </>
            ) : (
              <>
                <mesh geometry={GROUND_PIN_GEOMETRY} position={[0, 0.021, 0]}>
                  <meshBasicMaterial color={palette.gateway} />
                </mesh>
                <mesh geometry={GROUND_KNOB_GEOMETRY} position={[0, 0.045, 0]}>
                  <meshBasicMaterial color={selected ? palette.clientSelected : palette.client} />
                </mesh>
              </>
            )}

            <sprite position={[0, 0, 0]} scale={[0.15, 0.15, 1]}>
              <spriteMaterial
                map={glowTexture()}
                color={glowColor}
                transparent
                opacity={0.45}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>

            {outlined && (
              <mesh position={[0, 0.001, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.026, 0.0015, 6, 28]} />
                <meshBasicMaterial color={outlineColor} transparent opacity={0.85} />
              </mesh>
            )}

            <mesh
              geometry={SITE_HITBOX_GEOMETRY}
              material={HITBOX_MATERIAL}
              position={[0, 0.02, 0]}
              onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                onHover({ id: site.id, clientX: event.clientX, clientY: event.clientY });
              }}
              onPointerOut={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                onHover(null);
              }}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                onSelect(site.id);
              }}
            />

            {(showLabels || hovered || selected || outlined) && (
              <Html center occlude={!showLabels} distanceFactor={1.4} position={[0, 0.07, 0]} className="pointer-events-none">
                <span
                  className="whitespace-nowrap rounded-sm bg-surface-sunken px-[5px] py-[2px] font-display text-[11px] font-bold"
                  style={{ color: hovered || selected ? palette.label : palette.labelMuted }}
                >
                  {site.id}
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
