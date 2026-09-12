/**
 * Полярная азимутальная равнопромежуточная проекция (ADR-014).
 *
 * Радиус точки на карте пропорционален кошироте: полюс в центре, экватор на окружности
 * `radiusEquator`, противоположный полюс — на вдвое большей окружности. Азимут — долгота
 * в земной системе координат, поэтому наземные пункты сценария (широта и долгота) и
 * аппараты снимка (x, y, z) попадают в одну сетку без пересчёта времени.
 */

/** Средний радиус Земли, км. Нужен только чтобы перевести высоту орбиты в доли радиуса. */
export const EARTH_RADIUS_KM = 6371;

/** Полюс в центре карты. Южный центр нужен южным пунктам: иначе они уходят на край. */
export type Hemisphere = 'north' | 'south';

export interface PolarMapView {
  readonly kind: 'polar';
  readonly centerX: number;
  readonly centerY: number;
  /** Радиус экватора в пикселях полотна; южный полюс — на `2 × radiusEquator`. */
  readonly radiusEquator: number;
  readonly hemisphere: Hemisphere;
}

/** Flat equirectangular view for the schematic 2D mode.  It deliberately has
 * no "far side": a flat operations map must keep every spacecraft and route
 * inspectable instead of hiding half of the constellation behind a globe. */
export interface FlatMapView {
  readonly kind: 'flat';
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type MapView = PolarMapView | FlatMapView;

export interface Geo {
  readonly latDeg: number;
  readonly lonDeg: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const DEG = Math.PI / 180;

/** Направление вектора из центра Земли → широта и долгота. Длина вектора не важна. */
export function geoFromEcef(xKm: number, yKm: number, zKm: number): Geo {
  const length = Math.hypot(xKm, yKm, zKm);
  if (length === 0) {
    return { latDeg: 90, lonDeg: 0 };
  }
  return {
    latDeg: Math.asin(zKm / length) / DEG,
    lonDeg: Math.atan2(yKm, xKm) / DEG,
  };
}

/** Длина вектора в радиусах Земли: 1 — поверхность, больше — орбита. */
export function radiusInEarthRadii(xKm: number, yKm: number, zKm: number): number {
  return Math.hypot(xKm, yKm, zKm) / EARTH_RADIUS_KM;
}

/**
 * Коширота от центра проекции, градусы: 0 в центре, 180 в противоположном полюсе.
 * Нужна и для отрисовки, и для решения «точка на видимой половине или на обратной».
 */
export function colatitude(latDeg: number, hemisphere: Hemisphere): number {
  return hemisphere === 'north' ? 90 - latDeg : 90 + latDeg;
}

/**
 * Точка на карте. `lift` — радиальный сдвиг в радиусах Земли: им показывается высота
 * орбиты. Это оформление, а не координата: подспутниковая точка остаётся на своём
 * азимуте и своей кошироте, аппарат просто отодвинут от неё наружу.
 */
export function project(view: MapView, geo: Geo, lift = 0): Point {
  if (view.kind === 'flat') {
    const longitude = ((geo.lonDeg + 180) % 360 + 360) % 360;
    return {
      x: view.left + (longitude / 360) * view.width,
      // Orbital height becomes a restrained visual lift so the tracks read as
      // waves above the surface rather than as a second, unrelated map.
      y: view.top + ((90 - geo.latDeg) / 180) * view.height - lift * 18,
    };
  }
  const radius = (colatitude(geo.latDeg, view.hemisphere) / 90) * view.radiusEquator
    + lift * view.radiusEquator;
  const angle = geo.lonDeg * DEG;
  // Взгляд из-за северного полюса: оси x и y земной системы видны как «вправо» и «вверх».
  // Из-за южного та же сцена зеркальна по вертикали, иначе восток и запад меняются местами.
  const flip = view.hemisphere === 'north' ? -1 : 1;
  return {
    x: view.centerX + radius * Math.cos(angle),
    y: view.centerY + flip * radius * Math.sin(angle),
  };
}

/** Обратная задача: экранная точка → широта и долгота. Нужна подсказке пустого места. */
export function unproject(view: MapView, point: Point): Geo {
  if (view.kind === 'flat') {
    return {
      latDeg: 90 - ((point.y - view.top) / view.height) * 180,
      lonDeg: ((point.x - view.left) / view.width) * 360 - 180,
    };
  }
  const dx = point.x - view.centerX;
  const dy = point.y - view.centerY;
  const flip = view.hemisphere === 'north' ? -1 : 1;
  const colat = (Math.hypot(dx, dy) / view.radiusEquator) * 90;
  const lat = view.hemisphere === 'north' ? 90 - colat : colat - 90;
  return { latDeg: lat, lonDeg: Math.atan2(flip * dy, dx) / DEG };
}
