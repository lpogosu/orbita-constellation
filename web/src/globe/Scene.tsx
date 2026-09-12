import { useMemo } from 'react';
import type * as THREE from 'three';

import type { Plane } from '@/api/types';
import type { MapLayers, MapModel } from '@/map/model';
import type { MapPalette } from '@/map/palette';
import { ContactLines } from './ContactLines';
import { Earth } from './Earth';
import { ecefToScenePosition, LIGHT_DIRECTION, siteScenePosition } from './geo';
import { GroundSites } from './GroundSites';
import { OrbitPlanes } from './OrbitPlanes';
import { BackupRouteLine, RouteTube } from './RouteTube';
import { Satellites } from './Satellites';
import type { GlobeTextures } from './textures';
import type { GlobeHit } from './types';

export interface SceneModelInput {
  readonly model: MapModel;
  readonly layers: MapLayers;
  readonly planes: readonly Plane[];
  readonly inclinationDeg: number;
  readonly altitudeKm: number;
  readonly palette: MapPalette;
  readonly textures: GlobeTextures;
  readonly hoveredId: string | null;
  readonly onHover: (hit: GlobeHit | null) => void;
  readonly onSelectSatellite: (hit: GlobeHit) => void;
  readonly onSelectSite: (siteId: string) => void;
}

/** Содержимое `<Canvas>`: свет, Земля, орбиты, аппараты, наземные пункты, маршруты. */
export function Scene({
  model,
  layers,
  planes,
  inclinationDeg,
  altitudeKm,
  palette,
  textures,
  hoveredId,
  onHover,
  onSelectSatellite,
  onSelectSite,
}: SceneModelInput) {
  const positions = useMemo(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const satellite of model.satellites) {
      map.set(satellite.id, ecefToScenePosition(satellite.x_km, satellite.y_km, satellite.z_km));
    }
    for (const site of model.sites) {
      map.set(site.id, siteScenePosition(site.lat_deg, site.lon_deg));
    }
    return map;
  }, [model.satellites, model.sites]);

  const groundIds = useMemo(() => new Set(model.sites.map((site) => site.id)), [model.sites]);

  const mutedIds = useMemo(() => {
    const muted = new Set<string>();
    const components = model.components;
    if (components === null) {
      return muted;
    }
    const shown = new Set([...components.clientSide, ...components.gatewaySide]);
    for (const satellite of model.satellites) {
      if (!shown.has(satellite.id)) {
        muted.add(satellite.id);
      }
    }
    return muted;
  }, [model.components, model.satellites]);

  return (
    <>
      <ambientLight color={0x5274b5} intensity={0.92} />
      <directionalLight
        color={0xeaf1ff}
        intensity={1.45}
        position={[LIGHT_DIRECTION.x * 10, LIGHT_DIRECTION.y * 10, LIGHT_DIRECTION.z * 10]}
      />

      <Earth
        textures={textures}
        atmosphereColorA={palette.highlight}
        atmosphereColorB={palette.backup}
        fallbackColor={palette.grid}
        gridColor={palette.grid}
      />

      {layers.planes && (
        <OrbitPlanes
          planes={planes}
          planeIds={model.planeIds}
          inclinationDeg={inclinationDeg}
          altitudeKm={altitudeKm}
          palette={palette}
        />
      )}

      <ContactLines
        edges={model.edges}
        positions={positions}
        layers={layers}
        islColor={palette.isl}
        groundColor={palette.groundLink}
      />

      {layers.backup && model.backupRoute.length > 1 && (
        <BackupRouteLine
          path={model.backupRoute}
          positions={positions}
          groundIds={groundIds}
          color={palette.backup}
        />
      )}

      {model.selectedRoute.length > 1 && (
        <RouteTube
          path={model.selectedRoute}
          positions={positions}
          groundIds={groundIds}
          color={palette.route}
          glowColor={palette.route}
          radius={0.0042}
        />
      )}

      {layers.satellites && (
        <Satellites
          satellites={model.satellites}
          planes={planes}
          planeIds={model.planeIds}
          inclinationDeg={inclinationDeg}
          palette={palette}
          selectedRoute={model.selectedRoute}
          draftFailedSatellites={model.draftFailedSatellites}
          failureCandidates={model.failureCandidates}
          highlightedSatelliteId={model.highlightedSatelliteId}
          mutedIds={mutedIds}
          showLabels={layers.labels}
          hoveredId={hoveredId}
          onHover={(hit) => {
            onHover(hit === null ? null : { ...hit, kind: 'satellite' });
          }}
          onSelect={(hit) => {
            onSelectSatellite({ ...hit, kind: 'satellite' });
          }}
        />
      )}

      {layers.ground && (
        <GroundSites
          sites={model.sites}
          selectedClientId={model.selectedClientId}
          components={model.components}
          palette={palette}
          showLabels={layers.labels}
          hoveredId={hoveredId}
          onHover={(hit) => {
            onHover(hit === null ? null : { ...hit, kind: 'site' });
          }}
          onSelect={onSelectSite}
        />
      )}
    </>
  );
}
