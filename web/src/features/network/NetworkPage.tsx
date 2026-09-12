import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { networkApi } from '@/api/network';
import type { BackupPaths } from '@/api/types';
import { OUTAGES_PATH } from '@/app/sections';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton, UnavailableBlock } from '@/components/state/States';
import { describe } from '@/lib/use-resource';
import { MapCanvas } from '@/map/MapCanvas';
import type { SatelliteAction } from '@/map/MapCanvas';
import { MapLayersBar } from '@/map/MapLayersBar';
import { MapLegend } from '@/map/MapLegend';
import { DEFAULT_LAYERS } from '@/map/model';
import type { ComponentSplit, MapLayers, MapModel } from '@/map/model';
import { readPalette } from '@/map/palette';
import { useTokenColors } from '@/theme/use-token-colors';
import type { Hemisphere } from '@/map/projection';
import { Timeline } from '@/timeline/Timeline';
import type { TimelineTrack } from '@/timeline/Timeline';
import { formatTick } from '@/lib/run-format';
import { segmentsOf } from '@/features/result/timeline';
import { ConfigCard } from './ConfigCard';
import { useSceneEntry } from './entry';
import { FailureModal } from './FailureModal';
import type { FailureDraft } from './FailureModal';
import { NetworkStateCard } from './NetworkStateCard';
import { SaveVariantModal } from './SaveVariantModal';
import { clientSites, withFailures, withGatewayOutages } from './draft';
import { useNetworkScene } from './use-network-scene';

/** Координаты блоков из макета «03 · Сеть» (узел `33:249`) на полотне 1920×1080. */
const LAYOUT = {
  left: { x: 25, y: 134, width: 424, height: 722 },
  map: { x: 470, y: 134, width: 925, height: 666 },
  bar: { x: 470, y: 810 },
  right: { x: 1403, y: 134, width: 491, height: 722 },
  timeline: { x: 26, y: 872, width: 1868, height: 200 },
} as const;

export function NetworkPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  // Экран открывают ссылкой «показать этот момент»: вариант, расчёт и отсчёт берутся из
  // адреса, а не начинаются с нуля.
  const scene = useNetworkScene(projectId, useSceneEntry(search));

  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [hemisphere, setHemisphere] = useState<Hemisphere>('north');
  const [components, setComponents] = useState<ComponentSplit | null>(null);
  const [failureModal, setFailureModal] = useState<{ satelliteId: string | null } | null>(null);
  const [saveModal, setSaveModal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [backup, setBackup] = useState<BackupPaths | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const { draft, variant, run, seek, tS, selectVariant, selectClient } = scene;

  // Ссылка на экран воспроизводима: вариант, расчёт и отсчёт живут в query.
  useEffect(() => {
    const variantParam = search.get('variant');
    if (variantParam !== null && variantParam !== variant?.id) {
      selectVariant(variantParam);
    }
  }, [search, variant, selectVariant]);

  useEffect(() => {
    const next = new URLSearchParams(search);
    if (variant !== null) {
      next.set('variant', variant.id);
    }
    if (run !== null) {
      next.set('run', run.id);
    }
    next.set('t', String(tS));
    if (next.toString() !== search.toString()) {
      setSearch(next, { replace: true });
    }
  }, [variant, run, tS, search, setSearch]);

  const clients = useMemo(() => (draft === null ? [] : clientSites(draft)), [draft]);

  useEffect(() => {
    if (scene.selectedClientId === null && clients.length > 0) {
      selectClient(clients[0]?.id ?? null);
    }
  }, [clients, scene.selectedClientId, selectClient]);

  const selectedRoute = useMemo(
    () =>
      scene.snapshot?.clients.find((route) => route.client_id === scene.selectedClientId)?.path ?? [],
    [scene.snapshot, scene.selectedClientId],
  );

  const model = useMemo<MapModel>(() => {
    if (draft === null) {
      return {
        tS,
        satellites: [],
        edges: [],
        sites: [],
        slotBySatellite: new Map<string, number>(),
        planeIds: [],
        selectedRoute: [],
        backupRoute: [],
        components: null,
        selectedClientId: scene.selectedClientId,
        draftFailedSatellites: [],
        failureCandidates: [],
      };
    }
    return {
      tS,
      satellites: scene.snapshot?.satellites ?? [],
      edges: scene.snapshot?.edges ?? [],
      sites: draft.ground_sites,
      slotBySatellite: new Map(
        draft.design.satellites.map((satellite) => [satellite.id, satellite.slot_deg]),
      ),
      planeIds: draft.design.planes.map((plane) => plane.id),
      selectedRoute,
      backupRoute: backup?.paths[1] ?? [],
      components,
      selectedClientId: scene.selectedClientId,
      draftFailedSatellites: draft.failures
        .filter((failure) => tS >= failure.start_s && tS < failure.end_s)
        .map((failure) => failure.satellite_id),
      failureCandidates: [],
    };
  }, [draft, scene.snapshot, scene.selectedClientId, selectedRoute, backup, components, tS]);

  const readToken = useTokenColors();
  const palette = useMemo(() => readPalette(readToken), [readToken]);

  const timelineTracks = useMemo<TimelineTrack[]>(() => {
    if (scene.timeline === null) {
      return [];
    }
    return scene.timeline.clients.map((client) => ({
      clientId: client.client_id,
      segments: segmentsOf(client, scene.timeline?.total_ticks ?? 0),
    }));
  }, [scene.timeline]);

  const failureMarkers = useMemo(() => {
    if (draft === null) {
      return [];
    }
    return [
      ...draft.failures.map((failure, index) => ({
        id: `sat-${index}`,
        label: `Отказ ${failure.satellite_id}`,
        startS: failure.start_s,
        endS: failure.end_s,
      })),
      ...draft.gateway_outages.map((outage, index) => ({
        id: `gw-${index}`,
        label: `Шлюз ${outage.gateway_id}`,
        startS: outage.start_s,
        endS: outage.end_s,
      })),
    ];
  }, [draft]);

  const loadBackup = useCallback(() => {
    if (run === null || scene.selectedClientId === null) {
      return;
    }
    setBackupError(null);
    void networkApi.getBackupPaths(run.id, tS, scene.selectedClientId).then(setBackup, (cause: unknown) => {
      setBackup(null);
      setBackupError(describe(cause));
    });
  }, [run, scene.selectedClientId, tS]);

  const addFailure = useCallback(
    (failure: FailureDraft, keepOpen: boolean) => {
      if (draft === null) {
        return;
      }
      scene.setDraft(
        failure.kind === 'satellite'
          ? withFailures(draft, [...draft.failures, failure.value])
          : withGatewayOutages(draft, [...draft.gateway_outages, failure.value]),
      );
      setFailureModal(keepOpen ? { satelliteId: null } : null);
    },
    [draft, scene],
  );

  const startRun = useCallback(() => {
    if (variant === null) {
      return;
    }
    if (scene.dirty) {
      setSaveModal(true);
      return;
    }
    scene.runControl.start(variant.id, scene.policy);
  }, [variant, scene]);

  const saveVariant = useCallback(
    (title: string) => {
      setSaving(true);
      setSaveError(null);
      void scene.saveVariant(title).then(
        (created) => {
          setSaving(false);
          setSaveModal(false);
          if (created !== null) {
            scene.runControl.start(created.id, scene.policy);
          }
        },
        (cause: unknown) => {
          setSaving(false);
          setSaveError(describe(cause));
        },
      );
    },
    [scene],
  );

  const satelliteActions = useCallback(
    (satelliteId: string): SatelliteAction[] => [
      {
        label: 'Задать отказ',
        onSelect: () => { setFailureModal({ satelliteId }); },
      },
      {
        label: 'Показать критичность',
        onSelect: () => {
          navigate(`${OUTAGES_PATH}/${projectId}?satellite=${encodeURIComponent(satelliteId)}`);
        },
      },
    ],
    [navigate, projectId],
  );

  if (scene.projectError !== null) {
    return (
      <div className="absolute inset-x-[25px] top-[134px] h-[722px]">
        <ErrorBlock title="Проект не открылся" message={scene.projectError} onRetry={scene.reloadProject} />
      </div>
    );
  }

  if (draft === null || variant === null || scene.project === null) {
    return (
      <LoadingBlock label="Загружаем проект">
        <div className="absolute inset-x-[25px] top-[134px] flex gap-[21px]">
          <Skeleton className="h-[722px] w-[424px]" />
          <Skeleton className="h-[722px] flex-1" />
          <Skeleton className="h-[722px] w-[491px]" />
        </div>
      </LoadingBlock>
    );
  }

  const totalTicks = scene.totalTicks;

  return (
    <>
      <ConfigCard
        {...LAYOUT.left}
        draft={draft}
        variants={scene.project.variants}
        variantId={variant.id}
        onSelectVariant={selectVariant}
        onChange={scene.setDraft}
        policy={scene.policy}
        onPolicy={scene.setPolicy}
        changes={scene.changes}
        onReset={scene.resetDraft}
        onSaveVariant={() => { setSaveModal(true); }}
        onPreview={() => { seek(tS); }}
        onAddFailure={() => { setFailureModal({ satelliteId: null }); }}
        run={run}
        runStarting={scene.runControl.starting}
        runError={scene.runControl.error}
        onRun={startRun}
        onCancelRun={scene.runControl.cancel}
      />

      <div className="absolute" style={{ left: LAYOUT.map.x, top: LAYOUT.map.y }}>
        <MapCanvas
          model={model}
          layers={layers}
          hemisphere={hemisphere}
          width={LAYOUT.map.width}
          height={LAYOUT.map.height}
          onSelectSite={selectClient}
          satelliteActions={satelliteActions}
          renderTooltip={(hit) => <MapTooltip hit={hit} model={model} tS={tS} />}
        />

        <p
          className="pointer-events-none absolute left-[14px] top-[10px] rounded-pill border border-line bg-surface-raised px-[14px] py-[6px] text-caption font-semibold text-ink-primary"
          data-numeric
        >
          {formatTick(tS)} · отсчёт {scene.stepS > 0 ? Math.round(tS / scene.stepS) : 0} из {totalTicks}
          {scene.snapshotSource === 'preview' && ' · предпросмотр черновика'}
        </p>

        <MapLegend planeIds={model.planeIds} planeColors={palette.planes} />

        {scene.snapshot === null && scene.snapshotError === null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Skeleton className="size-[320px] rounded-pill" />
          </div>
        )}
        {scene.snapshotError !== null && (
          <div className="absolute inset-x-[80px] top-[240px]">
            <ErrorBlock
              title="Снимок не получен"
              message={scene.snapshotError}
              onRetry={() => { seek(tS); }}
            />
          </div>
        )}
      </div>

      <div className="absolute" style={{ left: LAYOUT.bar.x, top: LAYOUT.bar.y }}>
        <MapLayersBar
          width={LAYOUT.map.width}
          layers={layers}
          onChange={setLayers}
          hemisphere={hemisphere}
          onHemisphere={setHemisphere}
        />
      </div>

      <NetworkStateCard
        {...LAYOUT.right}
        tS={tS}
        stale={scene.dirty}
        clients={clients}
        snapshot={scene.snapshot}
        snapshotError={scene.snapshotError}
        metrics={scene.metrics}
        outages={scene.outages}
        resultsError={scene.resultsError}
        onReloadResults={scene.reloadResults}
        runReady={scene.runReady}
        targetAvailability={draft.environment.target_availability}
        selectedClientId={scene.selectedClientId}
        onSelectClient={selectClient}
        onSeek={seek}
        onShowComponents={setComponents}
        backup={backup}
        backupError={backupError}
        onLoadBackup={loadBackup}
      />

      <div className="absolute" style={{ left: LAYOUT.timeline.x, top: LAYOUT.timeline.y }}>
        <Timeline
          width={LAYOUT.timeline.width}
          height={LAYOUT.timeline.height}
          title={`${Math.round(draft.environment.horizon_s / 3600)} ч`}
          totalTicks={totalTicks}
          stepS={scene.stepS}
          tracks={timelineTracks}
          tS={tS}
          onSeek={seek}
          markers={failureMarkers}
          selectedClientId={scene.selectedClientId}
          onSelectClient={selectClient}
          onSelectOutage={(clientId, startS) => {
            selectClient(clientId);
            seek(startS);
          }}
          completedTicks={
            run !== null && (run.status === 'queued' || run.status === 'running')
              ? run.completed_ticks
              : null
          }
          placeholder={
            scene.runReady && timelineTracks.length > 0
              ? undefined
              : scene.resultsError !== null
                ? (
                    <ErrorBlock
                      title="Шкала не получена"
                      message={scene.resultsError}
                      onRetry={scene.reloadResults}
                      compact
                    />
                  )
                : run === null
                  ? (
                      <EmptyState
                        title="Расчётов ещё нет"
                        hint="Нажмите «Запустить расчёт» в левой панели — здесь появится доступность каждого клиента по суткам."
                        compact
                      />
                    )
                  : run.status === 'failed'
                    ? (
                        <ErrorBlock
                          title="Расчёт не завершился"
                          message={run.error?.message ?? 'Причина не пришла'}
                          onRetry={startRun}
                          retryLabel="Повторить расчёт"
                          compact
                        />
                      )
                    : (
                        <UnavailableBlock
                          title="Расчёт выполняется"
                          hint="Шкала заполнится, как только расчёт дойдёт до стадии аналитики."
                          compact
                        />
                      )
          }
        />
      </div>

      {failureModal !== null && (
        <FailureModal
          scenario={draft}
          presetSatelliteId={failureModal.satelliteId}
          onClose={() => { setFailureModal(null); }}
          onAdd={addFailure}
        />
      )}

      {saveModal && (
        <SaveVariantModal
          changes={scene.changes}
          parentTitle={variant.title}
          busy={saving}
          error={saveError}
          onClose={() => { setSaveModal(false); }}
          onSave={saveVariant}
        />
      )}
    </>
  );
}

function MapTooltip({
  hit,
  model,
  tS,
}: {
  hit: { kind: 'satellite' | 'site'; id: string };
  model: MapModel;
  tS: number;
}) {
  if (hit.kind === 'satellite') {
    const satellite = model.satellites.find((item) => item.id === hit.id);
    if (satellite === undefined) {
      return null;
    }
    const contacts = model.edges.filter((edge) => edge.a === hit.id || edge.b === hit.id).length;
    return (
      <>
        <p className="text-small font-semibold text-ink-primary">
          {satellite.id} <span className="text-caption font-normal text-ink-muted">плоскость {satellite.plane_id}</span>
        </p>
        <p className="mt-[4px] text-caption text-ink-secondary">
          {satellite.failed ? 'в отказе' : satellite.active ? 'активен' : 'не запущен на этом этапе'} ·
          контактов: {contacts}
        </p>
        {model.selectedRoute.includes(satellite.id) && (
          <p className="mt-[4px] text-caption text-accent-blue">
            в маршруте {model.selectedClientId ?? ''}
          </p>
        )}
      </>
    );
  }

  const site = model.sites.find((item) => item.id === hit.id);
  if (site === undefined) {
    return null;
  }
  return (
    <>
      <p className="text-small font-semibold text-ink-primary">
        {site.id} <span className="text-caption font-normal text-ink-muted">{site.role === 'gateway' ? 'шлюз' : 'клиент'}</span>
      </p>
      <p className="mt-[4px] text-caption text-ink-secondary">{site.name}</p>
      <p className="mt-[4px] text-caption text-ink-muted" data-numeric>
        {site.lat_deg.toFixed(2)}°, {site.lon_deg.toFixed(2)}° · {formatTick(tS)}
      </p>
    </>
  );
}
