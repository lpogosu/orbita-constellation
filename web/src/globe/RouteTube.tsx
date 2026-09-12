import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';

/** Точки маршрута приподняты над поверхностью на 2%, как в прототипе: иначе тело тюбика у
 *  наземного пункта частично тонет в сфере Земли и режется её геометрией. */
const GROUND_LIFT = 1.02;

interface RouteTubeProps {
  readonly path: readonly string[];
  readonly positions: ReadonlyMap<string, THREE.Vector3>;
  readonly groundIds: ReadonlySet<string>;
  readonly color: string;
  readonly glowColor: string;
  readonly radius: number;
}

/** Маршрут клиента — труба по `CatmullRomCurve3` через узлы пути, с аддитивным свечением. */
export function RouteTube({ path, positions, groundIds, color, glowColor, radius }: RouteTubeProps) {
  const curve = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (const id of path) {
      const point = positions.get(id);
      if (point === undefined) {
        continue;
      }
      points.push(groundIds.has(id) ? point.clone().multiplyScalar(GROUND_LIFT) : point.clone());
    }
    return points.length >= 2 ? new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.15) : null;
  }, [path, positions, groundIds]);

  const geometry = useMemo(
    () => (curve === null ? null : new THREE.TubeGeometry(curve, 200, radius, 8, false)),
    [curve, radius],
  );
  const glowGeometry = useMemo(
    () => (curve === null ? null : new THREE.TubeGeometry(curve, 100, radius * 3.6, 8, false)),
    [curve, radius],
  );

  if (geometry === null || glowGeometry === null) {
    return null;
  }

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh geometry={glowGeometry}>
        <meshBasicMaterial color={glowColor} transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Резервный маршрут — пунктирная линия, чтобы не путать с основным на глаз, а не только по цвету. */
export function BackupRouteLine({
  path,
  positions,
  groundIds,
  color,
}: {
  path: readonly string[];
  positions: ReadonlyMap<string, THREE.Vector3>;
  groundIds: ReadonlySet<string>;
  color: string;
}) {
  const points = useMemo<[number, number, number][]>(() => {
    const result: [number, number, number][] = [];
    for (const id of path) {
      const point = positions.get(id);
      if (point === undefined) {
        continue;
      }
      const lifted = groundIds.has(id) ? point.clone().multiplyScalar(GROUND_LIFT) : point;
      result.push([lifted.x, lifted.y, lifted.z]);
    }
    return result;
  }, [path, positions, groundIds]);

  if (points.length < 2) {
    return null;
  }

  return <Line points={points} color={color} lineWidth={2} dashed dashSize={0.03} gapSize={0.02} />;
}
