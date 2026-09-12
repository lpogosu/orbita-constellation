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
const EQUIRECT_SRC = '/assets/earth-equirect.webp';
// Use the production cut-outs with a real alpha channel. The older WebP files
// (`map-satellite.webp`/`map-gateway.webp`) contain a baked navy rectangle, which
// becomes visible whenever the sprite is drawn over the globe.
const SATELLITE_SRC = '/assets/orbita-satellite-mini-base.png';
const GATEWAY_SRC = '/assets/orbita-gateway-dish.png';

export interface MapSprites {
  readonly globe: HTMLImageElement;
  /** Реальная равнопрямоугольная текстура: из неё строится южный полярный диск. */
  readonly equirect: HTMLImageElement;
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
  spritesPromise ??= Promise.all([load(GLOBE_SRC), load(EQUIRECT_SRC), load(SATELLITE_SRC), load(GATEWAY_SRC)]).then(
    ([globe, equirect, satellite, gateway]) => ({ globe, equirect, satellite, gateway }),
  );
  return spritesPromise;
}

interface EarthCacheKey {
  readonly radiusEquator: number;
  readonly dpr: number;
  readonly hemisphere: 'north' | 'south';
}

let cached: (EarthCacheKey & { canvas: HTMLCanvasElement }) | null = null;

/**
 * Полотно с перепроецированной Землёй. Сторона полотна — `2 × radiusEquator` плюс поле
 * под свечение атмосферы, которое в исходнике выходит за диск.
 */
export function renderEarth(
  sprites: MapSprites,
  hemisphere: 'north' | 'south',
  radiusEquator: number,
  dpr: number,
): HTMLCanvasElement {
  if (
    cached !== null &&
    cached.radiusEquator === radiusEquator &&
    cached.dpr === dpr &&
    cached.hemisphere === hemisphere
  ) {
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
  const sourceSurface = sprites.globe.width * SURFACE_RATIO;
  const baseScale = radiusEquator / sourceSurface;

  // Сначала свечение атмосферы целиком: оно лежит вне диска, и перепроецировать его
  // нечем — там нет поверхности, только ореол.
  // Исходный полярный рендер слишком неоновый для основной карты. Приглушаем
  // его в Canvas, сохраняя холодный оттенок и контраст маршрута.
  ctx.filter = 'saturate(0.72) brightness(0.76)';
  drawScaled(ctx, sprites.globe, center, baseScale);

  ctx.filter = 'none';

  // `globe-polar.webp` — красивый, но северный снимок. Для центра «юг» оставляем его
  // атмосферное свечение, а сам диск строим из реальной глобальной текстуры в той же
  // азимутальной сетке, что и точки/контакты карты. Зеркалировать северный снимок нельзя:
  // это подменяет географию.
  if (hemisphere === 'south') {
    const south = renderSouthSurface(sprites.equirect, radiusEquator, dpr);
    ctx.drawImage(south, center - radiusEquator, center - radiusEquator, radiusEquator * 2, radiusEquator * 2);
  }

  cached = { radiusEquator, dpr, hemisphere, canvas };
  return canvas;
}

let equirectPixels: { readonly image: HTMLImageElement; readonly pixels: ImageData } | null = null;

function renderSouthSurface(
  equirect: HTMLImageElement,
  radiusEquator: number,
  dpr: number,
): HTMLCanvasElement {
  const side = Math.max(1, Math.ceil(radiusEquator * 2 * dpr));
  const surface = document.createElement('canvas');
  surface.width = side;
  surface.height = side;
  const ctx = surface.getContext('2d');
  if (ctx === null) {
    throw new Error('Canvas 2D недоступен');
  }

  const source = sourcePixels(equirect);
  const output = ctx.createImageData(side, side);
  const radius = radiusEquator * dpr;
  const center = side / 2;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) {
        continue;
      }
      const latitude = -90 + (distance / radius) * 90;
      const longitude = (Math.atan2(dy, dx) * 180) / Math.PI;
      const sourceX = Math.min(
        source.width - 1,
        Math.max(0, Math.round(((longitude + 180) / 360) * (source.width - 1))),
      );
      const sourceY = Math.min(
        source.height - 1,
        Math.max(0, Math.round(((90 - latitude) / 180) * (source.height - 1))),
      );
      const from = (sourceY * source.width + sourceX) * 4;
      const to = (y * side + x) * 4;
      output.data[to] = source.data[from] ?? 0;
      output.data[to + 1] = source.data[from + 1] ?? 0;
      output.data[to + 2] = source.data[from + 2] ?? 0;
      output.data[to + 3] = source.data[from + 3] ?? 0;
    }
  }
  ctx.putImageData(output, 0, 0);
  return surface;
}

function sourcePixels(image: HTMLImageElement): ImageData {
  if (equirectPixels?.image === image) {
    return equirectPixels.pixels;
  }
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  const context = source.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    throw new Error('Canvas 2D недоступен');
  }
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, source.width, source.height);
  equirectPixels = { image, pixels };
  return pixels;
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
