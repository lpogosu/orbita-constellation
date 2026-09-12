import { Clock, Link2 } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import type { ComparisonEntry, Plane, Run, Scenario } from '@/api/types';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton, UnavailableBlock } from '@/components/state/States';
import type { OrbitState } from '@/globe/Globe3D';
import { cx } from '@/lib/cx';
import { describe } from '@/lib/use-resource';
import { MapCanvas } from '@/map/MapCanvas';
import type { SatelliteAction } from '@/map/MapCanvas';
import { MapLayersBar } from '@/map/MapLayersBar';
import { MapLegend } from '@/map/MapLegend';
import { MapModeToggle } from '@/map/MapModeToggle';
import { splitComponents } from '@/map/components';
import { useMapMode } from '@/map/map-mode';
import type { MapMode } from '@/map/map-mode';
import { DEFAULT_LAYERS } from '@/map/model';
import type { MapLayers, MapModel } from '@/map/model';
import { readPalette } from '@/map/palette';
import { useTokenColors } from '@/theme/use-token-colors';
import type { Hemisphere } from '@/map/projection';

// Тот же ленивый импорт, что на «Сети»: экран «Отказы» тоже не должен тяжелеть из-за
// three.js, пока пользователь не выбрал 3D явно.
const Globe3D = lazy(() => import('@/globe/Globe3D'));
import { Timeline } from '@/timeline/Timeline';
import type { TimelineTrack } from '@/timeline/Timeline';
import { formatTick } from '@/lib/run-format';
import { segmentsOf } from '@/features/result/timeline';
import { FailureModal } from '@/features/network/FailureModal';
import type { FailureDraft } from '@/features/network/FailureModal';
import { clientSites, withFailures, withGatewayOutages } from '@/features/network/draft';
import { useSceneEntry } from '@/features/network/entry';
import { useNetworkScene } from '@/features/network/use-network-scene';
import { CriticalityCard } from './CriticalityCard';
import { FailuresCard } from './FailuresCard';
import type { FailureRowRef } from './FailuresCard';
import { rowKey } from './format';
import { RecommendationCard } from './RecommendationCard';
import { RerouteCard } from './RerouteCard';
import { useComparison, useCriticality, useRunSnapshot, useRunTimeline } from './use-comparison';

/** Координаты блоков из макета «04 · Отказы» (узел `41:351`) на полотне 1920×1080. */
const LAYOUT = {
  left: { x: 25, y: 124, width: 423, height: 703 },
  chips: { y: 120 },
  map: { x: 470, y: 186, width: 920, height: 600 },
  mapPair: { x: 470, y: 186, width: 700, height: 600, gap: 20 },
  bar: { x: 470, y: 794 },
  reroute: { x: 1403, y: 124, width: 488, height: 316 },
  criticality: { x: 1403, y: 454, width: 488, height: 212 },
  recommendation: { x: 1403, y: 678, width: 488, height: 160 },
  timeline: { x: 26, y: 852, width: 1868, height: 212 },
} as const;

type MapView = 'before' | 'after' | 'side';

export function OutagesPage() {
  const { projectId = '' } = useParams();
  const [search] = useSearchParams();
  const scene = useNetworkScene(projectId, useSceneEntry(search));

  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [hemisphere, setHemisphere] = useState<Hemisphere>('north');
  const [mapMode, setMapMode] = useMapMode();
  // Общая камера двух глобусов в режиме «Рядом»: без неё «до» и «после» пришлось бы
  // вращать по отдельности, и сравнивать маршруты на глаз стало бы неудобно.
  const [orbit, setOrbit] = useState<OrbitState | null>(null);
  const [view, setView] = useState<MapView>('after');
  const [synced, setSynced] = useState(true);
  const [frozenTS, setFrozenTS] = useState(0);
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set<string>());
  const [failureModal, setFailureModal] = useState<{ satelliteId: string | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [baseRunId, setBaseRunId] = useState<string | null>(null);
  const [afterRunId, setAfterRunId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [componentsShown, setComponentsShown] = useState(false);
  // Аппарат приходит из адреса пунктом «Показать критичность» на «Сети» и остаётся
  // выделенным, пока пользователь не выберет другой в списке критичности.
  const [focusSatelliteId, setFocusSatelliteId] = useState<string | null>(
    () => search.get('criticality'),
  );

  const { draft, variant, run, tS, seek, selectClient, selectVariant } = scene;

  // База сравнения — тот расчёт, который экран застал открытым. Дальше её выбирает
  // пользователь: после «Применить отказ» текущий расчёт станет стороной «после».
  useEffect(() => {
    if (baseRunId === null && run !== null && run.status === 'succeeded') {
      setBaseRunId(run.id);
    }
  }, [baseRunId, run]);

  useEffect(() => {
    if (run !== null && run.status === 'succeeded' && baseRunId !== null && run.id !== baseRunId) {
      setAfterRunId(run.id);
      setApplying(false);
    }
  }, [run, baseRunId]);

  const succeededRuns = useMemo<Run[]>(
    () => (scene.project?.recent_runs ?? []).filter((item) => item.status === 'succeeded'),
    [scene.project],
  );

  const rows = useMemo<FailureRowRef[]>(() => {
    if (draft === null) {
      return [];
    }
    return [
      ...draft.failures.map((failure, index) => ({
        kind: 'satellite' as const,
        index,
        id: failure.satellite_id,
        startS: failure.start_s,
        endS: failure.end_s,
      })),
      ...draft.gateway_outages.map((outage, index) => ({
        kind: 'gateway' as const,
        index,
        id: outage.gateway_id,
        startS: outage.start_s,
        endS: outage.end_s,
      })),
    ];
  }, [draft]);

  /** Сценарий, который уходит в расчёт: выключенные галочкой отказы в него не попадают. */
  const effectiveScenario = useCallback(
    (source: Scenario): Scenario =>
      withGatewayOutages(
        withFailures(
          source,
          source.failures.filter((_, index) => !disabled.has(rowKey('satellite', index))),
        ),
        source.gateway_outages.filter((_, index) => !disabled.has(rowKey('gateway', index))),
      ),
    [disabled],
  );

  const comparison = useComparison(baseRunId, afterRunId);
  const criticality = useCriticality(afterRunId ?? baseRunId);
  const before = useRunSnapshot(baseRunId, synced ? tS : frozenTS);
  const beforeTimeline = useRunTimeline(baseRunId);

  const clients = useMemo(() => (draft === null ? [] : clientSites(draft)), [draft]);

  // Вариант задаётся адресом так же, как на «Сети»: переключатель в шапке меняет запрос,
  // и экран обязан на это отозваться, а не остаться на варианте, с которого открылся.
  useEffect(() => {
    const wanted = search.get('variant');
    if (wanted !== null && wanted !== variant?.id) {
      selectVariant(wanted);
    }
  }, [selectVariant, search, variant]);

  // Переход с «Сети» просит посчитать критичность сразу: запрос уходит один раз на
  // прогон, иначе 501 возвращал бы экран в загрузку на каждую перерисовку.
  const criticalityAsked = useRef<string | null>(null);
  const requestCriticality = criticality.request;
  useEffect(() => {
    const runId = afterRunId ?? baseRunId;
    if (focusSatelliteId === null || runId === null || criticalityAsked.current === runId) {
      return;
    }
    criticalityAsked.current = runId;
    requestCriticality();
  }, [afterRunId, baseRunId, focusSatelliteId, requestCriticality]);

  useEffect(() => {
    if (scene.selectedClientId === null && clients.length > 0) {
      selectClient(clients[0]?.id ?? null);
    }
  }, [clients, scene.selectedClientId, selectClient]);

  const selectedComparison =
    comparison.entry?.per_client.find((item) => item.client_id === scene.selectedClientId) ?? null;

  const beforeRoute =
    before.snapshot?.clients.find((route) => route.client_id === scene.selectedClientId) ?? null;
  const afterRoute =
    scene.snapshot?.clients.find((route) => route.client_id === scene.selectedClientId) ?? null;

  const readToken = useTokenColors();
  const palette = useMemo(() => readPalette(readToken), [readToken]);

  const componentSplit = useMemo(
    () =>
      draft === null || scene.snapshot === null || scene.selectedClientId === null
        ? null
        : splitComponents(scene.snapshot, draft.ground_sites, scene.selectedClientId),
    [draft, scene.snapshot, scene.selectedClientId],
  );

  const buildModel = useCallback(
    (side: 'before' | 'after'): MapModel => {
      const snapshot = side === 'before' ? before.snapshot : scene.snapshot;
      const route = side === 'before' ? beforeRoute : afterRoute;
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
          highlightedSatelliteId: focusSatelliteId,
          draftFailedSatellites: [],
          failureCandidates: [],
        };
      }
      return {
        tS: synced || side === 'after' ? tS : frozenTS,
        satellites: snapshot?.satellites ?? [],
        edges: snapshot?.edges ?? [],
        sites: draft.ground_sites,
        slotBySatellite: new Map(
          draft.design.satellites.map((satellite) => [satellite.id, satellite.slot_deg]),
        ),
        planeIds: draft.design.planes.map((plane) => plane.id),
        selectedRoute: route?.path ?? [],
        backupRoute: [],
        components: side === 'after' && componentsShown ? componentSplit : null,
        selectedClientId: scene.selectedClientId,
        highlightedSatelliteId: focusSatelliteId,
        draftFailedSatellites:
          side === 'after'
            ? draft.failures
                .filter((failure) => tS >= failure.start_s && tS < failure.end_s)
                .map((failure) => failure.satellite_id)
            : [],
        // Кандидаты на отказ — аппараты маршрута «до»: именно их предлагает сценарий жюри.
        failureCandidates: picking ? (beforeRoute?.path ?? []) : [],
      };
    },
    [
      before.snapshot,
      scene.snapshot,
      scene.selectedClientId,
      beforeRoute,
      afterRoute,
      draft,
      tS,
      synced,
      frozenTS,
      componentSplit,
      componentsShown,
      focusSatelliteId,
      picking,
    ],
  );

  const timelineTracks = useMemo<TimelineTrack[]>(() => {
    const source = scene.timeline ?? beforeTimeline.timeline;
    if (source === null) {
      return [];
    }
    const baselineByClient = new Map(
      (beforeTimeline.timeline?.clients ?? []).map((client) => [client.client_id, client]),
    );
    return source.clients.map((client) => {
      const baselineClient = baselineByClient.get(client.client_id);
      const baseline =
        source === beforeTimeline.timeline || baselineClient === undefined
          ? undefined
          : segmentsOf(baselineClient, beforeTimeline.timeline?.total_ticks ?? 0);
      return {
        clientId: client.client_id,
        segments: segmentsOf(client, source.total_ticks),
        ...(baseline === undefined ? {} : { baseline }),
      };
    });
  }, [scene.timeline, beforeTimeline.timeline]);

  const failureMarkers = useMemo(() => {
    if (draft === null) {
      return [];
    }
    return draft.failures.map((failure, index) => ({
      id: `sat-${index}`,
      label: `Отказ ${failure.satellite_id}`,
      startS: failure.start_s,
      endS: failure.end_s,
    }));
  }, [draft]);

  const applyFailure = useCallback(() => {
    if (draft === null || variant === null) {
      return;
    }
    setApplying(true);
    setApplyError(null);
    // Сохраняется ровно то, что показано: выключенные галочкой отказы в сценарий не попали.
    const payload = effectiveScenario(draft);
    const title = `Отказ ${rows.map((row) => row.id).join(', ')}`.slice(0, 120);
    void scene
      .saveVariant(title, payload)
      .then((created) => {
        if (created === null) {
          setApplying(false);
          return;
        }
        scene.runControl.start(created.id, scene.policy);
      })
      .catch((cause: unknown) => {
        setApplying(false);
        setApplyError(describe(cause));
      });
  }, [draft, variant, rows, scene, effectiveScenario]);

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
      setPicking(false);
    },
    [draft, scene],
  );

  const satelliteActions = useCallback(
    (satelliteId: string): SatelliteAction[] => [
      { label: 'Задать отказ', onSelect: () => { setFailureModal({ satelliteId }); } },
    ],
    [],
  );

  if (scene.projectError !== null) {
    return (
      <div className="absolute inset-x-[25px] top-[124px] h-[703px]">
        <ErrorBlock title="Проект не открылся" message={scene.projectError} onRetry={scene.reloadProject} />
      </div>
    );
  }

  if (draft === null || variant === null || scene.project === null) {
    return (
      <LoadingBlock label="Загружаем проект">
        <div className="absolute inset-x-[25px] top-[124px] flex gap-[22px]">
          <Skeleton className="h-[703px] w-[423px]" />
          <Skeleton className="h-[703px] flex-1" />
          <Skeleton className="h-[703px] w-[488px]" />
        </div>
      </LoadingBlock>
    );
  }

  const mapWidth = view === 'side' ? LAYOUT.mapPair.width : LAYOUT.map.width;

  return (
    <>
      <FailuresCard
        {...LAYOUT.left}
        rows={rows}
        disabled={disabled}
        onToggle={(key: string) => {
          setDisabled((current) => {
            const next = new Set(current);
            if (next.has(key)) {
              next.delete(key);
            } else {
              next.add(key);
            }
            return next;
          });
        }}
        onRemove={(row) => {
          scene.setDraft(
            row.kind === 'satellite'
              ? withFailures(draft, draft.failures.filter((_, index) => index !== row.index))
              : withGatewayOutages(
                  draft,
                  draft.gateway_outages.filter((_, index) => index !== row.index),
                ),
          );
        }}
        onAdd={() => { setFailureModal({ satelliteId: null }); }}
        splitShown={componentsShown}
        splitAvailable={componentSplit !== null}
        onToggleSplit={() => { setComponentsShown((value) => !value); }}
        pickingOnMap={picking}
        onPickOnMap={() => { setPicking((value) => !value); }}
        baseRuns={succeededRuns}
        baseRunId={baseRunId}
        onBaseRun={setBaseRunId}
        applying={applying}
        applyError={applyError}
        onApply={applyFailure}
        onReset={() => {
          scene.resetDraft();
          setDisabled(new Set<string>());
          setComponentsShown(false);
        }}
        perClient={comparison.entry?.per_client ?? null}
        comparisonError={comparison.error}
        comparisonLoading={comparison.loading}
        selectedClientId={scene.selectedClientId}
        onSelectClient={selectClient}
        firstDivergenceTS={comparison.entry?.first_divergence_t_s ?? null}
        onSeek={seek}
      />

      <div
        className="absolute flex h-[52px] items-center gap-[14px] rounded-sm border border-line bg-surface-raised px-[21px]"
        style={{ left: 480, top: LAYOUT.chips.y }}
      >
        <Clock aria-hidden="true" className="size-[24px] text-ink-secondary" />
        <span className="text-title-l font-semibold text-ink-primary" data-numeric>
          {formatTick(tS)}
        </span>
      </div>

      <button
        type="button"
        aria-pressed={synced}
        onClick={() => {
          setFrozenTS(tS);
          setSynced((value) => !value);
        }}
        className={cx(
          'absolute flex h-[52px] items-center gap-[12px] rounded-sm border px-[16px] text-small font-medium transition-colors duration-150',
          synced ? 'border-line bg-surface-raised text-ink-primary' : 'border-line-subtle text-ink-muted',
        )}
        style={{ left: 648, top: LAYOUT.chips.y }}
        title="Одинаковый отсчёт на обеих картах и обеих шкалах"
      >
        <Link2 aria-hidden="true" className="size-[16px]" />
        Синхронный отсчёт
      </button>

      <div
        className="absolute flex h-[52px] items-center gap-[1px] rounded-sm border border-line bg-surface-track p-[3px]"
        style={{ left: 1050, top: LAYOUT.chips.y }}
      >
        {(
          [
            ['before', 'До'],
            ['after', 'После'],
            ['side', 'Рядом'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => { setView(value); }}
            className={cx(
              'h-[46px] w-[111px] rounded-[12px] text-base font-semibold transition-colors duration-150',
              view === value ? 'bg-accent-violet text-ink-onAccent' : 'text-ink-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'side' ? (
        <>
          <MapSlot
            x={LAYOUT.mapPair.x}
            y={LAYOUT.mapPair.y}
            width={LAYOUT.mapPair.width}
            height={LAYOUT.mapPair.height}
            caption={`До · ${formatTick(synced ? tS : frozenTS)}`}
            model={buildModel('before')}
            layers={layers}
            hemisphere={hemisphere}
            onSelectSite={selectClient}
            satelliteActions={satelliteActions}
            missing={baseRunId === null}
            planeColors={palette.planes}
            mode={mapMode}
            onModeChange={setMapMode}
            planes={draft.design.planes}
            inclinationDeg={draft.environment.inclination_deg}
            altitudeKm={draft.environment.altitude_km}
            orbit={orbit}
            onOrbitChange={setOrbit}
            onUnavailable={() => { setMapMode('2d'); }}
          />
          <MapSlot
            x={LAYOUT.mapPair.x + LAYOUT.mapPair.width + LAYOUT.mapPair.gap}
            y={LAYOUT.mapPair.y}
            width={LAYOUT.mapPair.width}
            height={LAYOUT.mapPair.height}
            caption={`После · ${formatTick(tS)}`}
            model={buildModel('after')}
            layers={layers}
            hemisphere={hemisphere}
            onSelectSite={selectClient}
            satelliteActions={satelliteActions}
            missing={false}
            planeColors={palette.planes}
            mode={mapMode}
            onModeChange={setMapMode}
            planes={draft.design.planes}
            inclinationDeg={draft.environment.inclination_deg}
            altitudeKm={draft.environment.altitude_km}
            orbit={orbit}
            onOrbitChange={setOrbit}
            onUnavailable={() => { setMapMode('2d'); }}
          />
        </>
      ) : (
        <MapSlot
          x={LAYOUT.map.x}
          y={LAYOUT.map.y}
          width={LAYOUT.map.width}
          height={LAYOUT.map.height}
          caption={
            view === 'before'
              ? `До · ${formatTick(synced ? tS : frozenTS)}`
              : `После · ${formatTick(tS)}`
          }
          model={buildModel(view)}
          layers={layers}
          hemisphere={hemisphere}
          onSelectSite={selectClient}
          satelliteActions={satelliteActions}
          missing={view === 'before' && baseRunId === null}
          planeColors={palette.planes}
          mode={mapMode}
          onModeChange={setMapMode}
          planes={draft.design.planes}
          inclinationDeg={draft.environment.inclination_deg}
          altitudeKm={draft.environment.altitude_km}
          onUnavailable={() => { setMapMode('2d'); }}
        />
      )}

      <div className="absolute" style={{ left: LAYOUT.bar.x, top: LAYOUT.bar.y }}>
        <MapLayersBar
          width={view === 'side' ? mapWidth * 2 + LAYOUT.mapPair.gap : mapWidth}
          layers={layers}
          onChange={setLayers}
          hemisphere={hemisphere}
          onHemisphere={setHemisphere}
        />
      </div>

      {view !== 'side' && (
        <>
          <RerouteCard
            {...LAYOUT.reroute}
            clientId={scene.selectedClientId}
            comparison={selectedComparison}
            beforeRoute={beforeRoute}
            afterRoute={afterRoute}
            beforeMetrics={clientMetrics(comparison.base, scene.selectedClientId)}
            afterMetrics={clientMetrics(comparison.entry, scene.selectedClientId)}
            loading={comparison.loading}
          />
          <CriticalityCard
            {...LAYOUT.criticality}
            state={criticality}
            runId={afterRunId ?? baseRunId}
            focusSatelliteId={focusSatelliteId}
            onFocusSatellite={setFocusSatelliteId}
          />
          <RecommendationCard
            {...LAYOUT.recommendation}
            entry={comparison.entry}
            baseTitle={comparison.base?.variant_title ?? null}
          />
        </>
      )}

      <div className="absolute" style={{ left: LAYOUT.timeline.x, top: LAYOUT.timeline.y }}>
        <Timeline
          width={LAYOUT.timeline.width}
          height={LAYOUT.timeline.height}
          title={`${Math.round(draft.environment.horizon_s / 3600)} ч`}
          totalTicks={scene.totalTicks}
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
          baselineLabel={
            baseRunId === null
              ? undefined
              : `тонкая полоса — база ${comparison.base?.variant_title ?? baseRunId.slice(0, 8)}`
          }
          placeholder={
            timelineTracks.length > 0
              ? undefined
              : (
                  <EmptyState
                    title="Шкал ещё нет"
                    hint="Задайте отказ и нажмите «Применить отказ»: снизу появятся две полосы на клиента — до и после."
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
    </>
  );
}

function MapSlot({
  x,
  y,
  width,
  height,
  caption,
  model,
  layers,
  hemisphere,
  onSelectSite,
  satelliteActions,
  missing,
  planeColors,
  mode,
  onModeChange,
  planes,
  inclinationDeg,
  altitudeKm,
  orbit,
  onOrbitChange,
  onUnavailable,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  caption: string;
  model: MapModel;
  layers: MapLayers;
  hemisphere: Hemisphere;
  onSelectSite: (siteId: string) => void;
  satelliteActions: (satelliteId: string) => SatelliteAction[];
  missing: boolean;
  planeColors: readonly string[];
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  planes: readonly Plane[];
  inclinationDeg: number;
  altitudeKm: number;
  orbit?: OrbitState | null;
  onOrbitChange?: (state: OrbitState) => void;
  onUnavailable: () => void;
}) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      {missing ? (
        <div
          className="rounded-2xl border border-line-subtle bg-surface-sunken"
          style={{ width, height }}
        >
          <UnavailableBlock
            title="Базы сравнения нет"
            hint="Выберите завершённый расчёт в поле «База сравнения» — на этой половине появится сеть до отказа."
          />
        </div>
      ) : mode === '2d' ? (
        <MapCanvas
          model={model}
          layers={layers}
          hemisphere={hemisphere}
          width={width}
          height={height}
          onSelectSite={onSelectSite}
          satelliteActions={satelliteActions}
          renderTooltip={(hit) => (
            <p className="text-small font-semibold text-ink-primary">{hit.id}</p>
          )}
        />
      ) : (
        <Suspense fallback={<Skeleton className="rounded-sm" style={{ width, height }} />}>
          <Globe3D
            model={model}
            layers={layers}
            planes={planes}
            inclinationDeg={inclinationDeg}
            altitudeKm={altitudeKm}
            width={width}
            height={height}
            onSelectSite={onSelectSite}
            satelliteActions={satelliteActions}
            renderTooltip={(hit) => (
              <p className="text-small font-semibold text-ink-primary">{hit.id}</p>
            )}
            orbit={orbit}
            onOrbitChange={onOrbitChange}
            onUnavailable={onUnavailable}
          />
        </Suspense>
      )}
      {!missing && <MapLegend planeIds={model.planeIds} planeColors={planeColors} />}
      <p
        className="pointer-events-none absolute left-[14px] top-[10px] rounded-pill border border-line bg-surface-raised px-[14px] py-[6px] text-caption font-semibold text-ink-primary"
        data-numeric
      >
        {caption}
      </p>
      <div className="pointer-events-none absolute right-[14px] top-[10px]">
        <MapModeToggle mode={mode} onChange={onModeChange} />
      </div>
    </div>
  );
}

function clientMetrics(entry: ComparisonEntry | null, clientId: string | null) {
  if (entry === null || clientId === null) {
    return null;
  }
  return entry.clients.find((item) => item.client_id === clientId) ?? null;
}
