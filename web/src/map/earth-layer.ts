/**
 * Подложка карты: фотография Земли из макета (узел «Globe»), перепроецированная в ту же
 * азимутальную равнопромежуточную сетку, в которой рисуются данные.
 *
 * Снимок глобуса ортографический: точка с коширотой θ лежит на радиусе `R·sin θ`. Данные
 * же по ADR-014 ложатся на радиус `R·θ/90`. Без пересчёта береговая линия и пункты
 * разъезжались бы на треть радиуса. Пересчёт делается кольцами: каждое кольцо
 * назначения — это то же изображение, отмасштабированное так, чтобы его ортографический
 * радиус совпал с равнопромежуточным. Результат кладётся в отдельное полотно и
 * перерисовывается только при смене размера или плотности пикселей.
 */

/** Доля радиуса диска Земли от ширины файла: из макета — 525.78 диаметра на 762 кадра. */
const SURFACE_RATIO = 262.89 / 762;

/** Колец достаточно, чтобы стык между ними не читался: проверено на радиусе 400 px. */
const RINGS = 64;

const GLOBE_SRC = '/assets/globe-polar.webp';
const SATELLITE_SRC = '/assets/map-satellite.webp';
const GATEWAY_SRC = '/assets/map-gateway.webp';

export interface MapSprites {
  readonly globe: HTMLImageElement;
  readonly satellite: HTMLImageElement;
  readonly gateway: HTMLImageElement;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error(`Не удалось загрузить ${src}`));
    };
    image.src = src;
  });
}

let spritesPromise: Promise<MapSprites> | null = null;

/** Картинки карты загружаются один раз на вкладку и переиспользуются всеми экранами. */
export function loadMapSprites(): Promise<MapSprites> {
  spritesPromise ??= Promise.all([load(GLOBE_SRC), load(SATELLITE_SRC), load(GATEWAY_SRC)]).then(
    ([globe, satellite, gateway]) => ({ globe, satellite, gateway }),
  );
  return spritesPromise;
}

interface EarthCacheKey {
  readonly radiusEquator: number;
  readonly dpr: number;
}

let cached: (EarthCacheKey & { canvas: HTMLCanvasElement }) | null = null;

/**
 * Полотно с перепроецированной Землёй. Сторона полотна — `2 × radiusEquator` плюс поле
 * под свечение атмосферы, которое в исходнике выходит за диск.
 */
export function renderEarth(
  globe: HTMLImageElement,
  radiusEquator: number,
  dpr: number,
): HTMLCanvasElement {
  if (cached !== null && cached.radiusEquator === radiusEquator && cached.dpr === dpr) {
    return cached.canvas;
  }

  const side = Math.ceil(radiusEquator * 2.6);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(side * dpr);
  canvas.height = Math.ceil(side * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Canvas 2D недоступен');
  }
  ctx.scale(dpr, dpr);

  const center = side / 2;
  const sourceSurface = globe.width * SURFACE_RATIO;
  const baseScale = radiusEquator / sourceSurface;

  // Сначала свечение атмосферы целиком: оно лежит вне диска, и перепроецировать его
  // нечем — там нет поверхности, только ореол.
  drawScaled(ctx, globe, center, baseScale);

  // Затем кольца поверх диска: от центра к экватору.
  for (let i = 0; i < RINGS; i += 1) {
    const inner = (radiusEquator * i) / RINGS;
    const outer = (radiusEquator * (i + 1)) / RINGS;
    const colatMid = ((i + 0.5) / RINGS) * 90;
    const sourceRadius = sourceSurface * Math.sin((colatMid * Math.PI) / 180);
    const destRadius = ((colatMid / 90) * radiusEquator);
    const scale = destRadius / sourceRadius;

    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, outer, 0, Math.PI * 2);
    if (inner > 0) {
      ctx.arc(center, center, inner, 0, Math.PI * 2, true);
    }
    ctx.clip('evenodd');
    drawScaled(ctx, globe, center, scale);
    ctx.restore();
  }

  cached = { radiusEquator, dpr, canvas };
  return canvas;
}

function drawScaled(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  center: number,
  scale: number,
): void {
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, center - width / 2, center - height / 2, width, height);
}
