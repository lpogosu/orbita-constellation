import * as THREE from 'three';

import { EARTH_RADIUS_KM, geoFromEcef, radiusInEarthRadii } from '@/map/projection';

/**
 * Перевод геокоординат в точку сцены three.js. Единица сцены — радиус Земли
 * (`EARTH_RADIUS_KM` из `map/projection.ts`), а не 1000 км: так орбита с высотой 800 км
 * ложится на разумный радиус ~1.125, как в прототипе `orbita-design/_globe/scene.html`.
 *
 * Ось Y сцены — полярная ось Земли (широта даёт `sin`), поэтому одна и та же формула
 * годится и наземному пункту (широта, долгота из сценария), и спутнику (широта и долгота,
 * посчитанные из ECEF той же `geoFromEcef`, что использует 2D-карта): расхождения осей
 * между экраном и глобусом взяться неоткуда — оба берут долготу и широту одним и тем же
 * способом.
 */
export function geoToScenePosition(latDeg: number, lonDeg: number, radiusInEarthRadiiUnits = 1): THREE.Vector3 {
  const lat = latDeg * (Math.PI / 180);
  const lon = lonDeg * (Math.PI / 180);
  return new THREE.Vector3(
    radiusInEarthRadiiUnits * Math.cos(lat) * Math.cos(lon),
    radiusInEarthRadiiUnits * Math.sin(lat),
    -radiusInEarthRadiiUnits * Math.cos(lat) * Math.sin(lon),
  );
}

/** Аппарат снимка → точка сцены. Координаты те же ECEF, что рисует 2D-карта. */
export function ecefToScenePosition(xKm: number, yKm: number, zKm: number): THREE.Vector3 {
  const geo = geoFromEcef(xKm, yKm, zKm);
  const radius = radiusInEarthRadii(xKm, yKm, zKm);
  return geoToScenePosition(geo.latDeg, geo.lonDeg, radius);
}

/** Наземный пункт сценария (широта/долгота) → точка на поверхности Земли. */
export function siteScenePosition(latDeg: number, lonDeg: number): THREE.Vector3 {
  return geoToScenePosition(latDeg, lonDeg, 1);
}

export { EARTH_RADIUS_KM };

/** Период оборота Земли вокруг оси, секунды (звёздные сутки, `core/orbita_core/geometry.py`). */
export const EARTH_ROTATION_PERIOD_S = 86164.09054;

/**
 * Угол поворота Земли на отсчёте `tS` (радианы, `docs/18_GLOBE_3D.md`). Тем же углом
 * сервер поворачивает инерциальные координаты в земные при сборке снимка
 * (`core/orbita_core/geometry.py`): `x_km/y_km/z_km` аппаратов в ответе API уже в этой,
 * вращающейся системе. Кольца орбитальных плоскостей строятся из `raan_deg` аналитически —
 * то есть в инерциальной системе, — и без обратного поворота на этот угол расходятся с
 * положением аппаратов на любом отсчёте, кроме нулевого.
 */
export function earthRotationAngleRad(earthAngle0Deg: number, tS: number): number {
  const rate = (2 * Math.PI) / EARTH_ROTATION_PERIOD_S;
  return earthAngle0Deg * (Math.PI / 180) + rate * tS;
}

/**
 * Направление на «солнце»: фиксировано в мировых координатах, а не привязано к камере —
 * иначе при повороте глобуса пользователем терминатор день/ночь скакал бы вместе с видом.
 * Значение то же, что в прототипе (`orbita-design/_globe/scene.html`).
 */
export const LIGHT_DIRECTION = geoToScenePosition(56, 34, 1).normalize();

/** Базис орбитальной плоскости: нормаль и два вектора в плоскости (`a` — узел RAAN). */
export interface PlaneBasis {
  readonly normal: THREE.Vector3;
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
}

/**
 * Базис строится из наклонения и RAAN сценария (`Environment.inclination_deg`,
 * `Plane.raan_deg`) — теми же формулами, что в прототипе, только на реальных параметрах
 * сценария вместо трёх зашитых плоскостей.
 */
export function planeBasis(raanDeg: number, inclinationDeg: number): PlaneBasis {
  const raan = raanDeg * (Math.PI / 180);
  const inc = inclinationDeg * (Math.PI / 180);
  const normal = new THREE.Vector3(
    Math.sin(inc) * Math.sin(raan),
    Math.cos(inc),
    Math.sin(inc) * Math.cos(raan),
  ).normalize();
  const a = new THREE.Vector3(Math.cos(raan), 0, -Math.sin(raan)).normalize();
  const b = new THREE.Vector3().crossVectors(normal, a).normalize();
  return { normal, a, b };
}

/** Точка орбитального кольца на угле `theta` (радианы) от узла RAAN. */
export function pointOnRing(basis: PlaneBasis, theta: number, radius: number): THREE.Vector3 {
  return basis.a.clone().multiplyScalar(Math.cos(theta) * radius)
    .add(basis.b.clone().multiplyScalar(Math.sin(theta) * radius));
}

/**
 * Локальный базис аппарата для ориентации по надиру: `y` смотрит на Землю (антенна вниз),
 * `z` — касательная к орбите (направление движения), `x` их дополняет. Угол движения
 * берётся проекцией текущего положения на базис плоскости, а не отдельной телеметрией
 * скорости — её в снимке нет, а плоскость уже даёт направление хода без него.
 */
export function nadirBasis(position: THREE.Vector3, basis: PlaneBasis): THREE.Matrix4 {
  const theta = Math.atan2(position.dot(basis.b), position.dot(basis.a));
  const tangent = basis.a.clone().multiplyScalar(-Math.sin(theta))
    .add(basis.b.clone().multiplyScalar(Math.cos(theta)))
    .normalize();
  const yAxis = position.clone().normalize().multiplyScalar(-1);
  const xAxis = new THREE.Vector3().crossVectors(yAxis, tangent).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
}
