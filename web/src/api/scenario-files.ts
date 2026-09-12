import { TransportError } from './client';

/**
 * Пример сценария из каталога `scenarios/` репозитория. Документ хранится как есть:
 * его форму проверяет сервис, а не браузер.
 */
export interface ScenarioExample {
  /** Имя файла — то, что инженер видит в каталоге и в карточке сценария. */
  readonly name: string;
  /** `meta.title` файла; пусто, если поле отсутствует — придумывать название нельзя. */
  readonly title: string;
  readonly document: unknown;
}

/**
 * Примеры — это файлы `scenarios/` с двузначным номером в начале имени. Каталог отдаёт
 * nginx (в разработке — плагин Vite), список приходит из его ответа, а не из константы в
 * коде: добавленный в репозиторий пятый файл не потребует правки фронтенда.
 */
const EXAMPLE_NAME = /^\d{2}_[a-z0-9_-]+\.json$/i;
const EXAMPLE_LIMIT = 4;
const DIRECTORY = '/scenarios/';

interface DirectoryEntry {
  name?: unknown;
  type?: unknown;
}

export async function loadScenarioExamples(): Promise<ScenarioExample[]> {
  const names = await listExampleNames();
  return Promise.all(names.map(fetchExample));
}

async function listExampleNames(): Promise<string[]> {
  const listing = await fetchJson(DIRECTORY);
  if (!Array.isArray(listing)) {
    throw new TransportError('Каталог примеров вернул не список файлов');
  }
  return (listing as DirectoryEntry[])
    .map((entry) => (typeof entry.name === 'string' ? entry.name : ''))
    .filter((name) => EXAMPLE_NAME.test(name))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, EXAMPLE_LIMIT);
}

async function fetchExample(name: string): Promise<ScenarioExample> {
  const document = await fetchJson(`${DIRECTORY}${encodeURIComponent(name)}`);
  return { name, document, title: readScenarioTitle(document) };
}

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new TransportError('Каталог примеров сценариев недоступен', { cause });
  }
  if (!response.ok) {
    throw new TransportError(`Каталог примеров сценариев ответил HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new TransportError('Файл примера не является корректным JSON', { cause });
  }
}

/** Название сценария из `meta.title`. Документ ещё не проверен, поэтому читается мягко. */
export function readScenarioTitle(document: unknown): string {
  if (typeof document !== 'object' || document === null) {
    return '';
  }
  const meta: unknown = (document as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) {
    return '';
  }
  const title: unknown = (meta as { title?: unknown }).title;
  return typeof title === 'string' ? title : '';
}
