import { useMemo } from 'react';
import * as THREE from 'three';

import type { SnapshotEdge } from '@/api/types';
import type { MapLayers } from '@/map/model';

interface ContactLinesProps {
  readonly edges: readonly SnapshotEdge[];
  readonly positions: ReadonlyMap<string, THREE.Vector3>;
  readonly layers: Pick<MapLayers, 'allContacts' | 'ground'>;
  readonly islColor: string;
  readonly groundColor: string;
}

/**
 * Все контакты отсчёта тонкими отрезками — ровно та же логика видимости, что у 2D-карты
 * (`map/draw.ts`, `drawContacts`): целиком рёбра рисуются только при включённом «Контакты»,
 * а внутри него наземные линии клиент/шлюз↔спутник ещё и отдельно гасятся «Наземные».
 * Один `LineSegments` на оба вида рёбер — сотни контактов не должны стоить сотен draw call.
 */
export function ContactLines({ edges, positions, layers, islColor, groundColor }: ContactLinesProps) {
  const geometries = useMemo(() => {
    if (!layers.allContacts) {
      return null;
    }
    const islPoints: number[] = [];
    const groundPoints: number[] = [];
    for (const edge of edges) {
      if (edge.kind === 'ground' && !layers.ground) {
        continue;
      }
      const a = positions.get(edge.a);
      const b = positions.get(edge.b);
      if (a === undefined || b === undefined) {
        continue;
      }
      const target = edge.kind === 'isl' ? islPoints : groundPoints;
      target.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const isl = new THREE.BufferGeometry();
    isl.setAttribute('position', new THREE.Float32BufferAttribute(islPoints, 3));
    const ground = new THREE.BufferGeometry();
    ground.setAttribute('position', new THREE.Float32BufferAttribute(groundPoints, 3));
    return { isl, ground };
  }, [edges, positions, layers.allContacts, layers.ground]);

  if (geometries === null) {
    return null;
  }

  return (
    <group>
      <lineSegments geometry={geometries.isl}>
        <lineBasicMaterial color={islColor} transparent opacity={0.5} />
      </lineSegments>
      <lineSegments geometry={geometries.ground}>
        <lineBasicMaterial color={groundColor} transparent opacity={0.45} />
      </lineSegments>
    </group>
  );
}
