import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { networkApi } from '@/api/network';
import type { BackupPaths } from '@/api/types';
import { OUTAGES_PATH } from '@/app/sections';
import { useHealth } from '@/app/use-health';
import { useStacked } from '@/app/viewport-mode';
import { DegradedBanner } from '@/components/layout/DegradedBanner';
import { PageStack, Slot } from '@/components/layout/Slot';
import { useContainerSize } from '@/components/layout/box';
import { EmptyState, ErrorBlock, LoadingBlock, Skeleton, UnavailableBlock } from '@/components/state/States';
import { Card } from '@/components/ui/Card';
import { cx } from '@/lib/cx';
import { describe } from '@/lib/use-resource';
import { MapCanvas } from '@/map/MapCanvas';
import type { SatelliteAction } from '@/map/MapCanvas';
import { MapLayersBar } from '@/map/MapLayersBar';
import { MapLegend } from '@/map/MapLegend';
import { MapModeToggle } from '@/map/MapModeToggle';
import { MapProjectionToggle } from '@/map/MapProjectionToggle';
import { splitComponents } from '@/map/components';
import { useMapMode } from '@/map/map-mode';
import { DEFAULT_LAYERS } from '@/map/model';
import type { MapHit, MapLayers, MapModel } from '@/map/model';
import { readPalette } from '@/map/palette';
import { useTokenColors } from '@/theme/use-token-colors';
import type { Hemisphere } from '@/map/projection';

// Тяжёлый three.js-модуль грузится только при первом переключении в 3D — экран «Сеть»
// не должен тяжелеть ради режима, которым не обязательно воспользуются.
const Globe3D = lazy(() => import('@/globe/Globe3D'));
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
import { STAGE_LABEL } from './use-run';
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
  const health = useHealth();

  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [hemisphere, setHemisphere] = useState<Hemisphere>('north');
  const [mapMode, setMapMode] = useMapMode();
  const [componentsShown, setComponentsShown] = useState(false);
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
  }, [search, variant?.id, selectVariant]);

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
  }, [variant?.id, run?.id, tS, search, setSearch]);

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

  // Подсветка объясняет конкретный перерыв, и переключатель живёт в его карточке:
  // на отсчёте, где связь есть, карточки нет — и подсветка снимается вместе с ней.
  const outageNow = useMemo(
    () =>
      (scene.outages ?? []).some(
        (outage) =>
          outage.client_id === scene.selectedClientId && tS >= outage.start_s && tS < outage.end_s,
      ),
    [scene.outages, scene.selectedClientId, tS],
  );

  // Компоненты связности считаются на клиенте по рёбрам снимка: в ответе `snapshot`
  // принадлежности аппарата к компоненте нет.
  const componentSplit = useMemo(
    () =>
      draft === null || scene.snapshot === null || scene.selectedClientId === null
        ? null
        : splitComponents(scene.snapshot, draft.ground_sites, scene.selectedClientId),
    [draft, scene.snapshot, scene.selectedClientId],
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
        highlightedSatelliteId: null,
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
      components: componentsShown && outageNow ? componentSplit : null,
      selectedClientId: scene.selectedClientId,
      highlightedSatelliteId: null,
      draftFailedSatellites: draft.failures
        .filter((failure) => tS >= failure.start_s && tS < failure.end_s)
        .map((failure) => failure.satellite_id),
      failureCandidates: [],
    };
  }, [
    draft,
    scene.snapshot,
    scene.selectedClientId,
    selectedRoute,
    backup,
    componentSplit,
    componentsShown,
    outageNow,
    tS,
  ]);

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

  // Окна получают постоянные обработчики закрытия: `Modal` переставляет фокус на первый
  // элемент при каждой смене `onClose`, и новая стрелка на каждый рендер экрана (а он
  // перерисовывается от прогресса расчёта) выдёргивала фокус из поля и прокручивала
  // окно на телефоне обратно к началу.
  const closeFailureModal = useCallback(() => {
    setFailureModal(null);
  }, []);
  const closeSaveModal = useCallback(() => {
    setSaveModal(false);
  }, []);

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
          // Экран «Отказы» открывается на том же расчёте и отсчёте, раскрывает блок
          // критичности и оставляет аппарат выделенным; окно отказа здесь не при чём.
          const query = new URLSearchParams({ t: String(tS), criticality: satelliteId });
          if (variant !== null) {
            query.set('variant', variant.id);
          }
          if (run !== null) {
            query.set('run', run.id);
          }
          navigate(`${OUTAGES_PATH}/${projectId}?${query.toString()}`);
        },
      },
    ],
    [navigate, projectId, run, tS, variant],
  );

  const renderMapTooltip = useCallback(
    (hit: MapHit) => <MapTooltip hit={hit} model={model} tS={tS} />,
    [model, tS],
  );

  const [mapProjection, setMapProjection] = useState<'terrain' | 'scheme'>('scheme');

  // Карта и шкала — canvas и WebGL: размер им нужен числом, из CSS они его не берут.
  // На полотне это макетные величины; в потоке ширину карты меряет её карточка, а шкала
  // раскладывается сама.
  const stacked = useStacked();

  const fallBackTo2d = useCallback(() => {
    setMapMode('2d');
  }, [setMapMode]);

  const banner = health.health?.degraded_mode === true && (
    <DegradedBanner health={health.health} onRefresh={health.refresh} />
  );

  if (scene.projectError !== null) {
    return stacked ? (
      <PageStack>
        {banner}
        <Card className="min-h-[320px]">
          <ErrorBlock title="Проект не открылся" message={scene.projectError} onRetry={scene.reloadProject} />
        </Card>
      </PageStack>
    ) : (
      <>
        {banner}
        <div className="absolute inset-x-[25px] top-[134px] h-[722px]">
          <ErrorBlock title="Проект не открылся" message={scene.projectError} onRetry={scene.reloadProject} />
        </div>
      </>
    );
  }

  if (draft === null || variant === null || scene.project === null) {
    return (
      <LoadingBlock label="Загружаем проект">
        {stacked ? (
          // Скелетон повторяет порядок блоков потока: карта, шкала, две панели.
          <PageStack className="md:grid md:grid-cols-2">
            {banner}
            <Skeleton className="h-[360px] rounded-2xl md:col-span-2" />
            <Skeleton className="h-[220px] rounded-2xl md:col-span-2" />
            <Skeleton className="h-[520px] rounded-2xl" />
            <Skeleton className="h-[520px] rounded-2xl" />
          </PageStack>
        ) : (
          <>
            {banner}
            <div className="absolute inset-x-[25px] top-[134px] flex gap-[21px]">
              <Skeleton className="h-[722px] w-[424px]" />
              <Skeleton className="h-[722px] flex-1" />
              <Skeleton className="h-[722px] w-[491px]" />
            </div>
          </>
        )}
      </LoadingBlock>
    );
  }

  const totalTicks = scene.totalTicks;

  const tickBadge = (
    <p
      className={cx(
        'rounded-pill border border-line bg-surface-raised px-[14px] py-[6px] text-caption font-semibold text-ink-primary',
        stacked ? 'min-w-0' : 'pointer-events-none absolute left-[14px] top-[10px]',
      )}
      data-numeric
    >
      {formatTick(tS)} · отсчёт {scene.stepS > 0 ? Math.round(tS / scene.stepS) : 0} из {totalTicks}
      {scene.snapshotSource === 'preview' && ' · предпросмотр черновика'}
    </p>
  );

  const renderMap = (size: { width: number; height: number }) => (
    <>
      {mapMode === '2d' ? (
        <MapCanvas
          model={model}
          layers={layers}
          hemisphere={hemisphere}
          projection={mapProjection}
          width={size.width}
          height={size.height}
          onSelectSite={selectClient}
          satelliteActions={satelliteActions}
          renderTooltip={renderMapTooltip}
          overlays={!stacked}
        />
      ) : (
        <Suspense
          fallback={<Skeleton className="rounded-sm" style={{ width: size.width, height: size.height }} />}
        >
          <Globe3D
            model={model}
            layers={layers}
            planes={draft.design.planes}
            inclinationDeg={draft.environment.inclination_deg}
            altitudeKm={draft.environment.altitude_km}
            earthAngle0Deg={draft.environment.earth_angle0_deg}
            hemisphere={hemisphere}
            width={size.width}
            height={size.height}
            onSelectSite={selectClient}
            satelliteActions={satelliteActions}
            renderTooltip={renderMapTooltip}
            onUnavailable={fallBackTo2d}
            overlayTop={stacked ? 0 : 48}
          />
        </Suspense>
      )}

      {mapMode === '2d' && scene.snapshot === null && scene.snapshotError === null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Skeleton
            className="rounded-pill"
            style={{ width: Math.min(320, size.height * 0.8), height: Math.min(320, size.height * 0.8) }}
          />
        </div>
      )}
      {scene.snapshotError !== null && (
        // Красный текст ошибки прямо поверх снимка Земли не читается ни в одной теме, поэтому
        // блок стоит на подложке: на полотне — плашкой по центру карты, в невысокой области
        // телефона, где макетный блок выше самой области, — на всю область.
        <div
          className={cx(
            'absolute inset-0 flex items-center justify-center',
            stacked && 'bg-surface-raised',
          )}
        >
          {stacked ? (
            <ErrorBlock
              title="Снимок не получен"
              message={scene.snapshotError}
              onRetry={scene.reloadSnapshot}
              compact={size.height < 300}
            />
          ) : (
            <div className="w-[496px] rounded-2xl border border-line bg-surface-raised shadow-card">
              <ErrorBlock
                title="Снимок не получен"
                message={scene.snapshotError}
                onRetry={scene.reloadSnapshot}
                appearance="figma"
              />
            </div>
          )}
        </div>
      )}
    </>
  );

  const layersBar = (
    <MapLayersBar
      width={LAYOUT.map.width}
      layers={layers}
      onChange={setLayers}
      hemisphere={hemisphere}
      onHemisphere={setHemisphere}
    />
  );

  return (
    <PageStack className="md:grid md:grid-cols-2 md:items-start">
      {banner}

      {stacked ? (
        <Card className="order-1 flex flex-col gap-[12px] p-[12px] md:col-span-2">
          <div className="flex flex-wrap items-center gap-[8px]">
            {tickBadge}
            <div className="ml-auto flex items-center gap-[8px]">
              {mapMode === '2d' && (
                <MapProjectionToggle projection={mapProjection} onChange={setMapProjection} />
              )}
              <MapModeToggle mode={mapMode} onChange={setMapMode} />
            </div>
          </div>
          <StackedMapArea mode={mapMode === '3d' ? 'globe' : mapProjection}>{renderMap}</StackedMapArea>
          <MapLegend planeIds={model.planeIds} planeColors={palette.planes} placement="inline" />
          {layersBar}
        </Card>
      ) : (
        <>
          <Slot box={LAYOUT.map}>
            {renderMap(LAYOUT.map)}
            {tickBadge}
            <div className="pointer-events-none absolute right-[14px] top-[10px]">
              <MapModeToggle mode={mapMode} onChange={setMapMode} />
            </div>
            {mapMode === '2d' && (
              <div className="pointer-events-none absolute right-[140px] top-[14px]">
                <MapProjectionToggle projection={mapProjection} onChange={setMapProjection} />
              </div>
            )}
            <MapLegend planeIds={model.planeIds} planeColors={palette.planes} />
          </Slot>
          <Slot box={LAYOUT.bar}>{layersBar}</Slot>
        </>
      )}

      <StackedCell className="order-3">
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
      </StackedCell>

      <StackedCell className="order-4">
        <NetworkStateCard
          {...LAYOUT.right}
          tS={tS}
          stale={scene.dirty}
          clients={clients}
          snapshot={scene.snapshot}
          snapshotError={scene.snapshotError}
          onReloadSnapshot={scene.reloadSnapshot}
          metrics={scene.metrics}
          outages={scene.outages}
          resultsError={scene.resultsError}
          onReloadResults={scene.reloadResults}
          runReady={scene.runReady}
          targetAvailability={draft.environment.target_availability}
          selectedClientId={scene.selectedClientId}
          onSelectClient={selectClient}
          onSeek={seek}
          componentSplit={componentSplit}
          componentsShown={componentsShown}
          onToggleComponents={() => { setComponentsShown((value) => !value); }}
          backup={backup}
          backupError={backupError}
          onLoadBackup={loadBackup}
        />
      </StackedCell>

      <Slot box={LAYOUT.timeline} stackedClassName="order-2 md:col-span-2">
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
                  : run.status === 'cancelled'
                    ? (
                        <EmptyState
                          title="Расчёт отменён"
                          hint="Шкала появится после нового запуска — кнопка «Запустить расчёт» в левой панели."
                          compact
                        />
                      )
                  : run.status === 'succeeded' && scene.timeline === null
                    ? (
                        // Расчёт готов, шкала ещё в пути: форма будущих треков, а не
                        // сообщение «расчёт выполняется», которое было бы неправдой.
                        <TimelineSkeleton rows={clients.length} />
                      )
                  : run.status === 'failed'
                    ? (
                        <ErrorBlock
                          title="Расчёт не завершился"
                          message={`${run.error?.message ?? 'Причина не пришла'} · стадия «${STAGE_LABEL[run.stage]}»`}
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
      </Slot>

      {failureModal !== null && (
        <FailureModal
          scenario={draft}
          presetSatelliteId={failureModal.satelliteId}
          onClose={closeFailureModal}
          onAdd={addFailure}
        />
      )}

      {saveModal && (
        <SaveVariantModal
          changes={scene.changes}
          parentTitle={variant.title}
          busy={saving}
          error={saveError}
          onClose={closeSaveModal}
          onSave={saveVariant}
        />
      )}
    </PageStack>
  );
}

/**
 * Обёртка блока, которая существует только в потоке: там ей задаётся место в сетке. На
 * полотне карточки ставят себя сами по макетным координатам, и лишний контейнер не нужен.
 */
function StackedCell({ className, children }: { className: string; children: ReactNode }) {
  return useStacked() ? <div className={className}>{children}</div> : <>{children}</>;
}

/** Доля высоты окна, выше которой карта в потоке не растёт: под ней должно быть видно шкалу. */
const STACKED_MAP_MAX_HEIGHT = 0.55;

/**
 * Область карты в потоке. Ширину меряет сама (карточка может быть уже окна на планшете),
 * высоту выбирает под то, что показывает: глобусу и полярному ландшафту нужен почти
 * квадрат, равнопромежуточной схеме — полоса около 2:1, иначе вокруг неё пустое поле.
 */
function StackedMapArea({
  mode,
  children,
}: {
  mode: 'globe' | 'terrain' | 'scheme';
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const [boxRef, box] = useContainerSize<HTMLDivElement>();
  const cap = Math.round(window.innerHeight * STACKED_MAP_MAX_HEIGHT);
  const height =
    mode === 'scheme'
      ? Math.max(220, Math.min(Math.round(box.width * 0.6), cap))
      : Math.max(300, Math.min(box.width, cap));

  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden rounded-lg border border-line-subtle bg-surface-sunken"
      style={{ height }}
    >
      {box.width > 0 && children({ width: box.width, height: height - 2 })}
    </div>
  );
}

/** Скелетон шкалы: по полосе на клиента, как лягут треки. */
function TimelineSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex h-full flex-col justify-center gap-[10px] px-[16px]">
      {Array.from({ length: Math.max(rows, 1) }, (_, index) => (
        <Skeleton key={index} className="h-[20px] w-full" />
      ))}
    </div>
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
