/**
 * Подложка карты: фотография Земли из макета (узел «Globe»), перепроецированная в ту же
 * азимутальную равнопромежуточную сетку, в которой рисуются данные. Сам ассет
 * уже содержит готовый полярный диск, поэтому мы рисуем его один раз без
 * повторного наложения концентрических колец.
 *
 * Снимок глобуса ортографический: точка с коширотой θ лежит на радиусе `R·sin θ`. Данные
 * же по ADR-014 ложатся на радиус `R·θ/90`. Без пересчёта береговая линия и пункты
 * разъезжались бы на треть радиуса. Пересчёт делается кольцами: каждое кольцо
 * назначения — это то же изображение, отмасштабированное так, чтобы его ортографический
 * радиус совпал с равнопромежуточным. Результат кладётся в отдельное полотно и
 * перерисовывается только при смене размера или плотности пикселей.
 */

/** Доля радиуса диска Земли от ширины исходного полярного ассета. */
const SURFACE_RATIO = 262.89 / 762;

const GLOBE_SRC = '/assets/globe-polar.webp';
// Use the production cut-outs with a real alpha channel. The older WebP files
// (`map-satellite.webp`/`map-gateway.webp`) contain a baked navy rectangle, which
// becomes visible whenever the sprite is drawn over the globe.
const SATELLITE_SRC = '/assets/orbita-satellite-mini-base.png';
const GATEWAY_SRC = '/assets/orbita-gateway-dish.png';

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
  // Исходный полярный рендер слишком неоновый для основной карты. Приглушаем
  // его в Canvas, сохраняя холодный оттенок и контраст маршрута.
  ctx.filter = 'saturate(0.72) brightness(0.76)';
  drawScaled(ctx, globe, center, baseScale);

  ctx.filter = 'none';

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
