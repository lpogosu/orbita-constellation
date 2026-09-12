import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';

import type { Plane, SnapshotSatellite } from '@/api/types';
import { planeColor } from '@/map/palette';
import type { MapPalette } from '@/map/palette';
import { ecefToScenePosition, nadirBasis, planeBasis } from './geo';
import {
  SATELLITE_ARM_GEOMETRY,
  SATELLITE_BODY_GEOMETRY,
  SATELLITE_COLLAR_GEOMETRY,
  SATELLITE_DISH_GEOMETRY,
  SATELLITE_HITBOX_GEOMETRY,
  SATELLITE_PANEL_GEOMETRY,
} from './geometries';
import { glowTexture } from './glow-texture';
import {
  HITBOX_MATERIAL,
  SATELLITE_BODY_DIMMED_MATERIAL,
  SATELLITE_BODY_MATERIAL,
  SATELLITE_COLLAR_DIMMED_MATERIAL,
  SATELLITE_COLLAR_MATERIAL,
  SATELLITE_DISH_DIMMED_MATERIAL,
  SATELLITE_DISH_MATERIAL,
  SATELLITE_PANEL_DIMMED_MATERIAL,
  SATELLITE_PANEL_FAILED_MATERIAL,
  SATELLITE_PANEL_MATERIAL,
} from './satellite-look';
import type { ScreenHit } from './types';

interface SatellitesProps {
  readonly satellites: readonly SnapshotSatellite[];
  readonly planes: readonly Plane[];
  readonly planeIds: readonly string[];
  readonly inclinationDeg: number;
  readonly palette: MapPalette;
  readonly selectedRoute: readonly string[];
  readonly draftFailedSatellites: readonly string[];
  readonly failureCandidates: readonly string[];
  readonly highlightedSatelliteId: string | null;
  readonly mutedIds: ReadonlySet<string>;
  readonly showLabels: boolean;
  readonly hoveredId: string | null;
  readonly onHover: (hit: ScreenHit | null) => void;
  readonly onSelect: (hit: ScreenHit) => void;
}

/**
 * Аппараты снимка настоящей геометрией из прототипа (корпус, воротник, две панели,
 * антенна), ориентированные по надиру. Базис плоскости считается один раз на плоскость и
 * переиспользуется всеми её аппаратами — не пересчитывается на каждый спутник заново.
 */
export function Satellites({
  satellites,
  planes,
  planeIds,
  inclinationDeg,
  palette,
  selectedRoute,
  draftFailedSatellites,
  failureCandidates,
  highlightedSatelliteId,
  mutedIds,
  showLabels,
  hoveredId,
  onHover,
  onSelect,
}: SatellitesProps) {
  const basisByPlane = useMemo(() => {
    const map = new Map<string, ReturnType<typeof planeBasis>>();
    for (const plane of planes) {
      map.set(plane.id, planeBasis(plane.raan_deg, inclinationDeg));
    }
    return map;
  }, [planes, inclinationDeg]);

  const placed = useMemo(
    () =>
      satellites.map((satellite) => {
        const position = ecefToScenePosition(satellite.x_km, satellite.y_km, satellite.z_km);
        const basis = basisByPlane.get(satellite.plane_id);
        const quaternion = new THREE.Quaternion();
        if (basis !== undefined) {
          quaternion.setFromRotationMatrix(nadirBasis(position, basis));
        }
        return { satellite, position, quaternion };
      }),
    [satellites, basisByPlane],
  );

  return (
    <group>
      {placed.map(({ satellite, position, quaternion }) => {
        const failed = satellite.failed || draftFailedSatellites.includes(satellite.id);
        const inRoute = selectedRoute.includes(satellite.id);
        const candidate = failureCandidates.includes(satellite.id);
        const highlighted = highlightedSatelliteId === satellite.id;
        const hovered = hoveredId === satellite.id;
        const muted = mutedIds.has(satellite.id);
        const color = planeColor(palette, planeIds, satellite.plane_id);
        const label = showLabels || hovered || inRoute || failed || highlighted;

        const bodyMaterial = satellite.active ? SATELLITE_BODY_MATERIAL : SATELLITE_BODY_DIMMED_MATERIAL;
        const collarMaterial = satellite.active ? SATELLITE_COLLAR_MATERIAL : SATELLITE_COLLAR_DIMMED_MATERIAL;
        const dishMaterial = satellite.active ? SATELLITE_DISH_MATERIAL : SATELLITE_DISH_DIMMED_MATERIAL;
        const panelMaterial = !satellite.active
          ? SATELLITE_PANEL_DIMMED_MATERIAL
          : failed
            ? SATELLITE_PANEL_FAILED_MATERIAL
            : SATELLITE_PANEL_MATERIAL;

        return (
          <group key={satellite.id} position={position} quaternion={quaternion} scale={1.35}>
            <group>
              <mesh geometry={SATELLITE_BODY_GEOMETRY} material={bodyMaterial} />
              <mesh geometry={SATELLITE_COLLAR_GEOMETRY} material={collarMaterial} position={[0, -0.01, 0]} />
              {[-1, 1].map((side) => (
                <group key={side}>
                  <mesh
                    geometry={SATELLITE_PANEL_GEOMETRY}
                    material={panelMaterial}
                    position={[side * 0.0335, 0, 0]}
                  />
                  <mesh
                    geometry={SATELLITE_ARM_GEOMETRY}
                    material={bodyMaterial}
                    position={[side * 0.0135, 0, 0]}
                  />
                </group>
              ))}
              <mesh
                geometry={SATELLITE_DISH_GEOMETRY}
                material={dishMaterial}
                position={[0, -0.018, 0]}
                rotation={[Math.PI, 0, 0]}
              />
            </group>

            <sprite scale={[0.075, 0.075, 1]}>
              <spriteMaterial
                map={glowTexture()}
                color={failed ? palette.failed : color}
                transparent
                opacity={muted ? 0.1 : 0.5}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>

            {highlighted && <RingMarker radius={0.026} color={palette.highlight} />}
            {candidate && <RingMarker radius={0.026} color={palette.clientSelected} dashed />}
            {inRoute && !failed && <RingMarker radius={0.022} color={palette.route} />}

            <mesh
              geometry={SATELLITE_HITBOX_GEOMETRY}
              material={HITBOX_MATERIAL}
              onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                onHover({ id: satellite.id, clientX: event.clientX, clientY: event.clientY });
              }}
              onPointerOut={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                onHover(null);
              }}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                onSelect({ id: satellite.id, clientX: event.clientX, clientY: event.clientY });
              }}
            />

            {label && (
              <Html center occlude={!showLabels} distanceFactor={1.4} position={[0, 0.028, 0]} className="pointer-events-none">
                <span
                  className="whitespace-nowrap rounded-sm bg-surface-sunken px-[4px] py-[1px] text-[10px] font-semibold"
                  style={{ color: hovered ? palette.label : palette.labelMuted }}
                >
                  {satellite.id}
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Кольцо-обводка вокруг аппарата: подсветка, кандидат на отказ или узел маршрута. */
function RingMarker({ radius, color, dashed = false }: { radius: number; color: string; dashed?: boolean }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, dashed ? 0.0009 : 0.0012, 6, dashed ? 16 : 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}
