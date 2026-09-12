/** Узел под курсором на глобусе вместе с экранными координатами клика — для тултипа и меню. */
export interface ScreenHit {
  readonly id: string;
  readonly clientX: number;
  readonly clientY: number;
}

/** То же самое, но с видом узла — тот же контракт, что `MapHit` у 2D-карты. */
export interface GlobeHit extends ScreenHit {
  readonly kind: 'satellite' | 'site';
}
