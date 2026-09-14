import { publicPath } from '@/lib/public-path';

/**
 * Ответы API в демо на GitHub Pages.
 *
 * Бэкенда у статического сайта нет, поэтому `scripts/record_demo.py` один раз проходит
 * экраны на поднятом стеке и сохраняет каждый ответ отдельным файлом, а здесь запрос
 * превращается обратно в `Response`. Экраны об этом не знают: ошибки приходят тем же
 * конвертом `05_API.md` §3 и показываются их собственными блоками ошибок.
 */

/** Запрос в разобранном виде и файл с телом ответа — строка `demo-data/index.json`. */
interface RecordedExchange {
  readonly method: string;
  readonly path: string;
  /** Параметры запроса парами, уже отсортированные записью. */
  readonly query: readonly (readonly [string, string])[];
  /** SHA-256 канонического JSON тела; `null` у запросов без тела. */
  readonly body_sha256: string | null;
  readonly status: number;
  readonly file: string;
}

interface RecordingIndex {
  readonly format: number;
  readonly exchanges: readonly RecordedExchange[];
}

interface TimedExchange {
  readonly tS: number;
  readonly exchange: RecordedExchange;
}

interface Recording {
  readonly exact: ReadonlyMap<string, RecordedExchange>;
  /** Запросы с `t_s`, сгруппированные по всему остальному ключу и упорядоченные по времени. */
  readonly series: ReadonlyMap<string, readonly TimedExchange[]>;
}

/** Должен совпадать с `RECORDING_FORMAT` в `scripts/record_demo.py`. */
const RECORDING_FORMAT = 1;
const DATA_DIR = 'demo-data/';
const TIME_PARAM = 't_s';

/**
 * POST, которые ничего не сохраняют: сравнение, предпросмотр, критичность и проверка
 * сценария считают ответ по телу запроса. Их отдаёт запись; все остальные методы меняют
 * данные сервиса и в демо отклоняются. Список разрешающий, а не запрещающий: новый
 * изменяющий endpoint не начнёт молча «работать» из записи.
 */
const READ_ONLY_POSTS: ReadonlySet<string> = new Set([
  '/api/comparisons',
  '/api/preview',
  '/api/analysis/criticality',
  '/api/scenarios/validate',
]);

// Сообщения показываются в существующих блоках ошибок, часто под кнопкой в узкой колонке,
// поэтому они короткие: что случилось и где взять полный стек.
// Сообщения короткие намеренно: они встают в строки карточек, рассчитанные макетом на
// одну-две строки, и главное — что делать — не должно уйти в многоточие.
const READ_ONLY_MESSAGE = 'Демо — только просмотр. Для расчётов поднимите стек: make up.';
const NOT_RECORDED_MESSAGE = 'Этого нет в записи демо. Свои расчёты — в стеке: make up.';
const DOWNLOAD_MESSAGE = 'Выгрузка файлов в демо недоступна. Полный стек — make up, см. README.';
const DATA_UNAVAILABLE_MESSAGE = 'Данные демо не загрузились: проверьте соединение и повторите.';

let recording: Promise<Recording> | null = null;

export async function replayRequest(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const url = new URL(path, window.location.origin);

  if (method !== 'GET' && !(method === 'POST' && READ_ONLY_POSTS.has(url.pathname))) {
    return errorResponse(403, 'DEMO_READ_ONLY', READ_ONLY_MESSAGE);
  }

  let loaded: Recording;
  try {
    loaded = await loadRecording();
  } catch {
    // Неудачная загрузка не запоминается: кнопка «Повторить» должна запросить индекс снова.
    recording = null;
    return errorResponse(503, 'DEMO_DATA_UNAVAILABLE', DATA_UNAVAILABLE_MESSAGE);
  }

  const query = sortedQuery(url.searchParams);
  const digest = method === 'POST' ? await bodyDigest(init.body) : null;
  const exchange =
    loaded.exact.get(exchangeKey(method, url.pathname, query, digest)) ??
    nearestInTime(loaded, method, url.pathname, query, digest);

  if (exchange === undefined) {
    return /\/(export|evidence-pack)$/.test(url.pathname)
      ? errorResponse(404, 'DEMO_NOT_RECORDED', DOWNLOAD_MESSAGE)
      : errorResponse(404, 'DEMO_NOT_RECORDED', NOT_RECORDED_MESSAGE);
  }

  const stored = await fetch(publicPath(DATA_DIR + exchange.file)).catch(() => null);
  if (stored === null || !stored.ok) {
    return errorResponse(503, 'DEMO_DATA_UNAVAILABLE', DATA_UNAVAILABLE_MESSAGE);
  }
  return new Response(await stored.text(), {
    status: exchange.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function loadRecording(): Promise<Recording> {
  recording ??= fetch(publicPath(`${DATA_DIR}index.json`)).then(async (response) => {
    if (!response.ok) {
      throw new Error(`index.json: HTTP ${response.status}`);
    }
    const index = (await response.json()) as RecordingIndex;
    if (index.format !== RECORDING_FORMAT) {
      throw new Error(`формат записи ${index.format}, ожидался ${RECORDING_FORMAT}`);
    }
    return indexRecording(index.exchanges);
  });
  return recording;
}

function indexRecording(exchanges: readonly RecordedExchange[]): Recording {
  const exact = new Map<string, RecordedExchange>();
  const series = new Map<string, TimedExchange[]>();

  for (const exchange of exchanges) {
    exact.set(exchangeKey(exchange.method, exchange.path, exchange.query, exchange.body_sha256), exchange);

    const time = exchange.query.find(([name]) => name === TIME_PARAM);
    const tS = time === undefined ? Number.NaN : Number(time[1]);
    if (Number.isFinite(tS)) {
      const key = seriesKey(exchange.method, exchange.path, exchange.query, exchange.body_sha256);
      const points = series.get(key) ?? [];
      points.push({ tS, exchange });
      series.set(key, points);
    }
  }
  for (const points of series.values()) {
    points.sort((left, right) => left.tS - right.tS);
  }
  return { exact, series };
}

/**
 * Снимок сети записан не на каждый из 720 отсчётов, а на сетке: запрос на отсчёт между
 * узлами получает ближайший записанный. Ответ несёт свой настоящий `t_s`, так что экран
 * не выдаёт соседний отсчёт за запрошенный.
 */
function nearestInTime(
  loaded: Recording,
  method: string,
  path: string,
  query: readonly (readonly [string, string])[],
  digest: string | null,
): RecordedExchange | undefined {
  const time = query.find(([name]) => name === TIME_PARAM);
  const tS = time === undefined ? Number.NaN : Number(time[1]);
  if (!Number.isFinite(tS)) {
    return undefined;
  }
  const points = loaded.series.get(seriesKey(method, path, query, digest));
  let best: TimedExchange | undefined;
  for (const point of points ?? []) {
    if (best === undefined || Math.abs(point.tS - tS) < Math.abs(best.tS - tS)) {
      best = point;
    }
  }
  return best?.exchange;
}

/**
 * Значения параметров входят в ключ без процентного кодирования: браузер и Python кодируют
 * одни и те же символы по-разному, а сравнивать нужно смысл запроса, а не его написание.
 */
function exchangeKey(
  method: string,
  path: string,
  query: readonly (readonly [string, string])[],
  digest: string | null,
): string {
  const search = query.map(([name, value]) => `${name}=${value}`).join('&');
  return `${method} ${path}?${search}#${digest ?? ''}`;
}

function seriesKey(
  method: string,
  path: string,
  query: readonly (readonly [string, string])[],
  digest: string | null,
): string {
  return exchangeKey(method, path, query.filter(([name]) => name !== TIME_PARAM), digest);
}

function sortedQuery(params: URLSearchParams): (readonly [string, string])[] {
  return [...params.entries()].sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName ? compare(leftValue, rightValue) : compare(leftName, rightName),
  );
}

function compare(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Тело сравнивается по смыслу: ключи объектов сортируются, числа пишутся так, как их
 * написал `JSON.stringify` в клиенте. Та же канонизация повторена в `record_demo.py`.
 */
async function bodyDigest(body: RequestInit['body']): Promise<string | null> {
  if (typeof body !== 'string') {
    return null;
  }
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return null;
  }
  const bytes = new TextEncoder().encode(canonicalJson(document));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
