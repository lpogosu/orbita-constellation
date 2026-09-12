import type { GroundSite, SnapshotSatellite } from '@/api/types';
import { drawFlatEarth, renderEarth } from './earth-layer';
import type { MapSprites } from './earth-layer';
import type { MapLayers, MapModel } from './model';
import { planeColor } from './palette';
import type { MapPalette } from './palette';
import { EARTH_RADIUS_KM, colatitude, geoFromEcef, project, radiusInEarthRadii } from './projection';
import type { MapView, Point } from './projection';

// Canvas не разбирает CSS-переменные внутри `font`, поэтому семейства заданы строками —
// теми же, что стоят в токенах.
const SANS = "'Inter Variable', Inter, system-ui, sans-serif";
const DISPLAY = "Montserrat, 'Inter Variable', system-ui, sans-serif";

/** Размер спрайта аппарата в пикселях полотна; подписи и маркеры отказа считаются от него. */
const SATELLITE_WIDTH = 30;
/** Поле у края холста: меньше него подпись подрезается собственным прямоугольником. */
const LABEL_PADDING = 5;
const SITE_RING = 8;
const SITE_CORE = 4.6;

export interface DrawResult {
  /** Экранные координаты узлов: ими же делается попадание курсора. */
  readonly positions: ReadonlyMap<string, Point>;
  readonly satelliteIds: readonly string[];
  readonly siteIds: readonly string[];
}

export interface DrawInput {
  readonly model: MapModel;
  readonly view: MapView;
  readonly layers: MapLayers;
  readonly palette: MapPalette;
  readonly sprites: MapSprites | null;
  readonly hoveredId: string | null;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, input: DrawInput): DrawResult {
  const { model, view, layers, palette, sprites } = input;

  ctx.save();
  ctx.setTransform(input.dpr, 0, 0, input.dpr, 0, 0);
  ctx.clearRect(0, 0, input.width, input.height);

  const positions = new Map<string, Point>();
  // Узлы за экватором обратной от центра проекции стороны: полюс сменить можно, но узел
  // сценария остаётся тем же самым, и на карте северного полушария южный клиент должен
  // читаться как «на обратной стороне», а не как обычная точка у самого края.
  const farSide = new Set<string>();

  for (const satellite of model.satellites) {
    const geo = geoFromEcef(satellite.x_km, satellite.y_km, satellite.z_km);
    const lift = radiusInEarthRadii(satellite.x_km, satellite.y_km, satellite.z_km) - 1;
    positions.set(satellite.id, project(view, geo, lift));
    if (view.kind === 'polar' && colatitude(geo.latDeg, view.hemisphere) > 90) {
      farSide.add(satellite.id);
    }
  }
  for (const site of model.sites) {
    positions.set(site.id, project(view, { latDeg: site.lat_deg, lonDeg: site.lon_deg }));
    if (view.kind === 'polar' && colatitude(site.lat_deg, view.hemisphere) > 90) {
      farSide.add(site.id);
    }
  }

  if (layers.planes) {
    drawPlanes(ctx, model, palette, view);
  }

  // Орбиты проходят за Землёй, как в макете: центральный диск сохраняет
  // читаемый силуэт, а линии появляются по краю и не режут карту пополам.
  if (sprites !== null && view.kind === 'polar') {
    const earth = renderEarth(sprites, view.hemisphere, view.radiusEquator, input.dpr);
    const side = earth.width / input.dpr;
    ctx.drawImage(earth, view.centerX - side / 2, view.centerY - side / 2, side, side);
  }
  if (sprites !== null && view.kind === 'flat') {
    drawFlatEarth(ctx, sprites, view);
  }
  drawGraticule(ctx, input, palette);

  if (layers.allContacts) {
    drawContacts(ctx, model, layers, palette, positions, view.kind === 'flat');
  }
  if (layers.backup && model.backupRoute.length > 1) {
    drawPath(ctx, model.backupRoute, positions, palette.backup, view.kind === 'flat' ? 3.2 : 2.5, [7, 6]);
  }
  if (model.selectedRoute.length > 1) {
    drawPath(ctx, model.selectedRoute, positions, palette.route, view.kind === 'flat' ? 4 : 3, []);
  }

  const muted = mutedByComponents(model);

  if (layers.satellites) {
    for (const satellite of model.satellites) {
      const point = positions.get(satellite.id);
      if (point === undefined) {
        continue;
      }
      drawSatellite(ctx, input, satellite, point, muted.has(satellite.id) || farSide.has(satellite.id));
    }
  }

  // Маркеры компонент идут поверх аппаратов: под спрайтом обводка не видна.
  if (model.components !== null && layers.satellites) {
    drawComponents(ctx, model.components, palette, positions);
  }

  for (const site of model.sites) {
    const point = positions.get(site.id);
    if (point === undefined) {
      continue;
    }
    drawSite(ctx, input, site, point, farSide.has(site.id));
  }

  ctx.restore();

  return {
    positions,
    satelliteIds: model.satellites.map((satellite) => satellite.id),
    siteIds: model.sites.map((site) => site.id),
  };
}

/** Сетка кошироты: окружности через 30° и меридианы через 30° с подписью четырёх главных. */
function drawGraticule(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  palette: MapPalette,
): void {
  const { view } = input;
  ctx.save();
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;

  if (view.kind === 'flat') {
    drawFlatGraticule(ctx, input, palette);
    ctx.restore();
    return;
  }

  for (let colat = 30; colat <= 180; colat += 30) {
    const radius = (colat / 90) * view.radiusEquator;
    ctx.beginPath();
    ctx.setLineDash(colat === 90 ? [] : [3, 5]);
    ctx.arc(view.centerX, view.centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.setLineDash([3, 5]);
  const outer = 2 * view.radiusEquator;
  for (let lon = 0; lon < 360; lon += 30) {
    const end = project(view, { latDeg: -90, lonDeg: lon });
    ctx.beginPath();
    ctx.moveTo(view.centerX, view.centerY);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.fillStyle = palette.labelMuted;
  ctx.font = `500 11px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [lon, label] of [
    [0, '0°'],
    [90, '90°в'],
    [180, '180°'],
    [270, '90°з'],
  ] as const) {
    const at = project(view, { latDeg: -90, lonDeg: lon });
    const dx = at.x - view.centerX;
    const dy = at.y - view.centerY;
    const length = Math.hypot(dx, dy) || 1;
    // Кольцо южного полюса упирается в край холста: подпись на нём вышла бы за границу и
    // читалась бы половиной цифр, поэтому она заводится внутрь.
    fillTextInside(
      ctx,
      label,
      view.centerX + (dx / length) * (outer + 12),
      view.centerY + (dy / length) * (outer + 12),
      input,
    );
  }
  ctx.restore();
}

function drawFlatGraticule(ctx: CanvasRenderingContext2D, input: DrawInput, palette: MapPalette): void {
  const { view } = input;
  if (view.kind !== 'flat') {
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(view.left, view.top, view.width, view.height);
  ctx.clip();
  ctx.setLineDash([3, 5]);
  for (let longitude = 0; longitude <= 360; longitude += 30) {
    const x = view.left + (longitude / 360) * view.width;
    ctx.moveTo(x, view.top);
    ctx.lineTo(x, view.top + view.height);
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const y = view.top + ((90 - latitude) / 180) * view.height;
    ctx.moveTo(view.left, y);
    ctx.lineTo(view.left + view.width, y);
  }
  ctx.strokeStyle = palette.grid;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = palette.labelMuted;
  ctx.font = `500 11px ${SANS}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('180°', view.left + 6, view.top + 6);
  ctx.textAlign = 'right';
  ctx.fillText('180°', view.left + view.width - 6, view.top + 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('0°', view.left + view.width / 2, view.top + view.height - 6);
  ctx.restore();
}

/** Плоскость — замкнутая ломаная через свои аппараты в порядке `slot_deg` сценария. */
function drawPlanes(
  ctx: CanvasRenderingContext2D,
  model: MapModel,
  palette: MapPalette,
  view: MapView,
): void {
  const byPlane = new Map<string, SnapshotSatellite[]>();
  for (const satellite of model.satellites) {
    const list = byPlane.get(satellite.plane_id);
    if (list === undefined) {
      byPlane.set(satellite.plane_id, [satellite]);
    } else {
      list.push(satellite);
    }
  }

  ctx.save();

  for (const [planeId, satellites] of byPlane) {
    const ordered = [...satellites].sort(
      (a, b) => (model.slotBySatellite.get(a.id) ?? 0) - (model.slotBySatellite.get(b.id) ?? 0),
    );
    if (ordered.length < 3) {
      continue;
    }

    const color = planeColor(palette, model.planeIds, planeId);
    ctx.strokeStyle = color;
    ctx.beginPath();
    let started = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const from = ordered[index];
      const to = ordered[(index + 1) % ordered.length];
      if (from !== undefined && to !== undefined) {
        traceOrbitArc(ctx, view, from, to, started);
        started = true;
      }
    }
    // Мягкая цветная дорожка отделяет плоскости от подложки, а тонкий пунктир сохраняет
    // визуальную плотность Figma и не перетягивает внимание у маршрута.
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 7]);
    const flat = view.kind === 'flat';
    ctx.globalAlpha = flat ? 0.24 : 0.1;
    ctx.lineWidth = flat ? 5.5 : 4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.globalAlpha = flat ? 0.82 : 0.38;
    ctx.lineWidth = flat ? 1.8 : 1.25;
    ctx.shadowBlur = 0;
    ctx.stroke();
  }
  ctx.restore();
}

/** Орбита рисуется дугой на сфере, а не хордой между экранными точками. Прежняя
 * хорда особенно заметно ломалась после переключения на центр «юг». */
function traceOrbitArc(
  ctx: CanvasRenderingContext2D,
  view: MapView,
  from: SnapshotSatellite,
  to: SnapshotSatellite,
  skipFirst: boolean,
): void {
  const fromLength = Math.hypot(from.x_km, from.y_km, from.z_km) || 1;
  const toLength = Math.hypot(to.x_km, to.y_km, to.z_km) || 1;
  const a = [from.x_km / fromLength, from.y_km / fromLength, from.z_km / fromLength] as const;
  const b = [to.x_km / toLength, to.y_km / toLength, to.z_km / toLength] as const;
  const angle = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const segments = Math.max(3, Math.ceil(angle / (Math.PI / 30)));
  const sinAngle = Math.sin(angle);

  let previous: Point | null = null;
  for (let step = skipFirst ? 1 : 0; step <= segments; step += 1) {
    const t = step / segments;
    const left = sinAngle < 1e-5 ? 1 - t : Math.sin((1 - t) * angle) / sinAngle;
    const right = sinAngle < 1e-5 ? t : Math.sin(t * angle) / sinAngle;
    const x = a[0] * left + b[0] * right;
    const y = a[1] * left + b[1] * right;
    const z = a[2] * left + b[2] * right;
    const length = Math.hypot(x, y, z) || 1;
    const radius = fromLength + (toLength - fromLength) * t;
    const point = project(view, geoFromEcef(x / length, y / length, z / length), radius / EARTH_RADIUS_KM - 1);
    const crossesDateLine = view.kind === 'flat' && previous !== null && Math.abs(point.x - previous.x) > view.width * 0.5;
    if ((step === 0 && !skipFirst) || crossesDateLine) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
    previous = point;
  }
}

function drawContacts(
  ctx: CanvasRenderingContext2D,
  model: MapModel,
  layers: MapLayers,
  palette: MapPalette,
  positions: ReadonlyMap<string, Point>,
  flat: boolean,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  drawContactSet(ctx, model, positions, 'isl', palette.isl, [5, 6], flat);
  if (layers.ground) {
    drawContactSet(ctx, model, positions, 'ground', palette.groundLink, [], flat);
  }
  ctx.restore();
}

/** Два прохода на тип контакта — постоянное число штриховок, даже когда рёбер сотни. */
function drawContactSet(
  ctx: CanvasRenderingContext2D,
  model: MapModel,
  positions: ReadonlyMap<string, Point>,
  kind: 'isl' | 'ground',
  color: string,
  dash: readonly number[],
  flat: boolean,
): void {
  ctx.beginPath();
  let hasSegments = false;
  for (const edge of model.edges) {
    if (edge.kind !== kind) {
      continue;
    }
    const a = positions.get(edge.a);
    const b = positions.get(edge.b);
    if (a === undefined || b === undefined) {
      continue;
    }
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    hasSegments = true;
  }
  if (!hasSegments) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.setLineDash([...dash]);
  ctx.globalAlpha = flat ? (kind === 'isl' ? 0.28 : 0.22) : (kind === 'isl' ? 0.12 : 0.1);
  ctx.lineWidth = flat ? 4.2 : 3.2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.stroke();

  ctx.globalAlpha = flat ? (kind === 'isl' ? 0.92 : 0.82) : (kind === 'isl' ? 0.72 : 0.6);
  ctx.lineWidth = flat ? (kind === 'isl' ? 1.65 : 1.45) : (kind === 'isl' ? 1.15 : 1);
  ctx.shadowBlur = 0;
  ctx.stroke();
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  path: readonly string[],
  positions: ReadonlyMap<string, Point>,
  color: string,
  width: number,
  dash: readonly number[],
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([...dash]);
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  let started = false;
  for (const id of path) {
    const point = positions.get(id);
    if (point === undefined) {
      continue;
    }
    if (started) {
      ctx.lineTo(point.x, point.y);
    } else {
      ctx.moveTo(point.x, point.y);
      started = true;
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Аппараты вне обеих компонент: они приглушаются, чтобы разбиение читалось сразу. */
function mutedByComponents(model: MapModel): ReadonlySet<string> {
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
}

/**
 * Две изолированные группы аппаратов. Различаются формой обводки, а не только цветом:
 * по цвету одному читателю из двенадцати их не различить.
 */
function drawComponents(
  ctx: CanvasRenderingContext2D,
  components: { readonly clientSide: readonly string[]; readonly gatewaySide: readonly string[] },
  palette: MapPalette,
  positions: ReadonlyMap<string, Point>,
): void {
  ctx.save();
  ctx.lineWidth = 2;

  ctx.strokeStyle = palette.route;
  for (const id of components.clientSide) {
    const point = positions.get(id);
    if (point === undefined) {
      continue;
    }
    ctx.strokeRect(point.x - 13, point.y - 13, 26, 26);
  }

  ctx.strokeStyle = palette.backup;
  for (const id of components.gatewaySide) {
    const point = positions.get(id);
    if (point === undefined) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - 15);
    ctx.lineTo(point.x + 15, point.y);
    ctx.lineTo(point.x, point.y + 15);
    ctx.lineTo(point.x - 15, point.y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSatellite(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  satellite: SnapshotSatellite,
  point: Point,
  muted: boolean,
): void {
  const { model, palette, sprites } = input;
  const failed = satellite.failed || model.draftFailedSatellites.includes(satellite.id);
  const inRoute = model.selectedRoute.includes(satellite.id);
  const candidate = model.failureCandidates.includes(satellite.id);
  const highlighted = model.highlightedSatelliteId === satellite.id;
  const hovered = input.hoveredId === satellite.id;

  ctx.save();
  if (muted) {
    ctx.globalAlpha = 0.25;
  }

  if (highlighted) {
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, SATELLITE_WIDTH * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (candidate) {
    ctx.strokeStyle = palette.clientSelected;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, SATELLITE_WIDTH * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (sprites !== null) {
    const width = SATELLITE_WIDTH;
    const height = (sprites.satellite.height / sprites.satellite.width) * width;
    const solid = ctx.globalAlpha;
    ctx.globalAlpha = satellite.active ? solid : solid * 0.32;
    ctx.drawImage(sprites.satellite, point.x - width / 2, point.y - height / 2, width, height);
    ctx.globalAlpha = solid;
  } else {
    ctx.fillStyle = planeColor(palette, model.planeIds, satellite.plane_id);
    const solid = ctx.globalAlpha;
    ctx.globalAlpha = satellite.active ? solid : solid * 0.32;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = solid;
  }

  if (failed) {
    // Маркер отказа из макета (узел 41:1024): круг с крестом, а не другой цвет спрайта.
    const radius = SATELLITE_WIDTH * 0.45;
    ctx.fillStyle = 'rgba(26, 10, 24, 0.75)';
    ctx.strokeStyle = palette.failed;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath();
    const arm = radius * 0.48;
    ctx.moveTo(point.x - arm, point.y - arm);
    ctx.lineTo(point.x + arm, point.y + arm);
    ctx.moveTo(point.x + arm, point.y - arm);
    ctx.lineTo(point.x - arm, point.y + arm);
    ctx.stroke();
  } else if (inRoute) {
    ctx.strokeStyle = palette.route;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, SATELLITE_WIDTH * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 720 спутников нельзя подписывать одновременно: слой оставляет подписи
  // маршрута и событий, остальные доступны через hover/tooltip.
  if (hovered || inRoute || failed || highlighted) {
    ctx.fillStyle = hovered ? palette.label : palette.labelMuted;
    ctx.font = `600 11px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    fillTextInside(ctx, satellite.id, point.x, point.y - SATELLITE_WIDTH * 0.55, input);
  }

  ctx.restore();
}

function drawSite(
  ctx: CanvasRenderingContext2D,
  input: DrawInput,
  site: GroundSite,
  point: Point,
  farSide: boolean,
): void {
  const { model, palette, sprites, view } = input;
  const selected = site.id === model.selectedClientId;
  const hovered = input.hoveredId === site.id;
  const components = model.components;
  const outlined =
    components !== null &&
    (components.clientSiteId === site.id || components.gatewaySiteIds.includes(site.id));

  ctx.save();
  // Обратная сторона текущего полюса приглушается, а не прячется: пункт остаётся
  // кликабельным и виден у края диска, но явно второстепенен рядом с центром проекции.
  if (farSide) {
    ctx.globalAlpha = 0.4;
  }

  if (outlined) {
    ctx.strokeStyle = components.clientSiteId === site.id ? palette.route : palette.backup;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, SITE_RING + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (site.role === 'gateway' && sprites !== null) {
    const width = 46;
    const height = (sprites.gateway.height / sprites.gateway.width) * width;
    ctx.drawImage(sprites.gateway, point.x - width / 2, point.y - height, width, height);
  } else {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.3;
    ctx.shadowColor = selected ? palette.clientSelected : palette.client;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(point.x, point.y, SITE_RING, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = selected ? palette.clientSelected : palette.client;
    ctx.beginPath();
    ctx.arc(point.x, point.y, SITE_CORE, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = palette.label;
  ctx.font = `700 ${hovered || selected ? 17 : 15}px ${DISPLAY}`;
  ctx.textBaseline = 'bottom';
  // Подпись уводится от центра карты, чтобы не легла на Землю поверх маршрута.
  const mapCenterX = view.kind === 'polar' ? view.centerX : view.left + view.width / 2;
  const away = point.x >= mapCenterX ? 1 : -1;
  ctx.textAlign = away > 0 ? 'left' : 'right';
  fillTextInside(ctx, site.id, point.x + away * (SITE_RING + 8), point.y - SITE_RING, input);

  ctx.restore();
}

/**
 * Подпись, целиком попадающая в холст. Прямоугольник текста считается по текущим
 * `textAlign` и `textBaseline`, поэтому точка привязки сдвигается ровно настолько,
 * насколько подпись вылезла за край, и ни на пиксель больше.
 */
function fillTextInside(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bounds: { readonly width: number; readonly height: number },
): void {
  const metrics = ctx.measureText(text);
  const half = metrics.width / 2;
  const extentLeft = finite(metrics.actualBoundingBoxLeft, half);
  const extentRight = finite(metrics.actualBoundingBoxRight, half);
  const extentUp = finite(metrics.actualBoundingBoxAscent, 8);
  const extentDown = finite(metrics.actualBoundingBoxDescent, 3);

  ctx.fillText(
    text,
    clamp(x, LABEL_PADDING + extentLeft, bounds.width - LABEL_PADDING - extentRight),
    clamp(y, LABEL_PADDING + extentUp, bounds.height - LABEL_PADDING - extentDown),
  );
}

/** Если поле уже шире холста, двигать некуда: подпись остаётся на своём месте. */
function clamp(value: number, min: number, max: number): number {
  return max < min ? value : Math.min(Math.max(value, min), max);
}

function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** Ближайший узел к точке: аппараты имеют приоритет, у них меньше площадь. */
export function hitTest(
  result: DrawResult,
  point: Point,
  radius = 18,
): { kind: 'satellite' | 'site'; id: string } | null {
  interface Candidate {
    kind: 'satellite' | 'site';
    id: string;
    distance: number;
  }

  const candidates: Candidate[] = [];

  const consider = (kind: 'satellite' | 'site', id: string): void => {
    const at = result.positions.get(id);
    if (at === undefined) {
      return;
    }
    const distance = Math.hypot(at.x - point.x, at.y - point.y);
    if (distance <= radius) {
      candidates.push({ kind, id, distance });
    }
  };

  for (const id of result.siteIds) {
    consider('site', id);
  }
  for (const id of result.satelliteIds) {
    consider('satellite', id);
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  return best === undefined ? null : { kind: best.kind, id: best.id };
}
