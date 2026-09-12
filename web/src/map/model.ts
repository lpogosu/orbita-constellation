import type { GroundSite, SnapshotEdge, SnapshotSatellite } from '@/api/types';

/** Слои карты (`14_SCREENS.md` §2.2). «Все контакты» по умолчанию выключены — иначе каша. */
export interface MapLayers {
  readonly planes: boolean;
  readonly satellites: boolean;
  readonly allContacts: boolean;
  readonly ground: boolean;
  readonly labels: boolean;
  readonly backup: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  planes: true,
  satellites: true,
  allContacts: false,
  ground: true,
  labels: false,
  backup: false,
};

/** Две изолированные группы аппаратов из доказательств перерыва (`OutageInterval`). */
export interface ComponentSplit {
  readonly clientSide: readonly string[];
  readonly gatewaySide: readonly string[];
}

/**
 * Всё, что рисуется. Модель собирается экраном из ответов API: карта ничего не считает и
 * ничего не запрашивает сама.
 */
export interface MapModel {
  readonly tS: number;
  readonly satellites: readonly SnapshotSatellite[];
  readonly edges: readonly SnapshotEdge[];
  readonly sites: readonly GroundSite[];
  /** `slot_deg` аппарата из сценария: по нему аппараты плоскости выстраиваются в дугу. */
  readonly slotBySatellite: ReadonlyMap<string, number>;
  readonly planeIds: readonly string[];
  readonly selectedRoute: readonly string[];
  readonly backupRoute: readonly string[];
  readonly components: ComponentSplit | null;
  readonly selectedClientId: string | null;
  /** Аппараты, которым уже задан отказ в черновике: помечены и вне снимка. */
  readonly draftFailedSatellites: readonly string[];
  /** Аппараты текущего маршрута — кандидаты на отказ (`14_SCREENS.md` §3.1). */
  readonly failureCandidates: readonly string[];
}

export const EMPTY_MODEL: MapModel = {
  tS: 0,
  satellites: [],
  edges: [],
  sites: [],
  slotBySatellite: new Map<string, number>(),
  planeIds: [],
  selectedRoute: [],
  backupRoute: [],
  components: null,
  selectedClientId: null,
  draftFailedSatellites: [],
  failureCandidates: [],
};

/** Узел под курсором: карта сообщает экрану, что именно он показывает или выбирает. */
export interface MapHit {
  readonly kind: 'satellite' | 'site';
  readonly id: string;
  readonly x: number;
  readonly y: number;
}
