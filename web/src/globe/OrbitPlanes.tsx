import { Line } from '@react-three/drei';
import { useMemo } from 'react';

import type { Plane } from '@/api/types';
import { planeColor } from '@/map/palette';
import type { MapPalette } from '@/map/palette';
import { EARTH_RADIUS_KM, planeBasis, pointOnRing } from './geo';

const SEGMENTS = 128;

interface OrbitPlanesProps {
  readonly planes: readonly Plane[];
  readonly planeIds: readonly string[];
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
  readonly palette: MapPalette;
}

/**
 * Орбитальные плоскости трубками… точнее линиями по окружности радиуса `R + altitude_km`,
 * повёрнутой на наклонение и RAAN сценария (`docs/18_GLOBE_3D.md`): 128 точек на плоскость,
 * без единого зашитого числа — состав плоскостей и их RAAN берутся из `Scenario.design`.
 */
export function OrbitPlanes({ planes, planeIds, inclinationDeg, altitudeKm, palette }: OrbitPlanesProps) {
  const radius = (EARTH_RADIUS_KM + altitudeKm) / EARTH_RADIUS_KM;

  const rings = useMemo(
    () =>
      planes.map((plane) => {
        const basis = planeBasis(plane.raan_deg, inclinationDeg);
        const points: [number, number, number][] = [];
        for (let i = 0; i <= SEGMENTS; i += 1) {
          const theta = (i / SEGMENTS) * Math.PI * 2;
          const point = pointOnRing(basis, theta, radius);
          points.push([point.x, point.y, point.z]);
        }
        return { id: plane.id, points };
      }),
    [planes, inclinationDeg, radius],
  );

  return (
    <group>
      {rings.map((ring) => (
        <Line
          key={ring.id}
          points={ring.points}
          color={planeColor(palette, planeIds, ring.id)}
          lineWidth={1.4}
          transparent
          opacity={0.34}
          dashed
          dashSize={0.045}
          gapSize={0.03}
        />
      ))}
    </group>
  );
}
