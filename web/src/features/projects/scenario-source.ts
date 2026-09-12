import type { ScenarioExample } from '@/api/scenario-files';
import { readScenarioTitle } from '@/api/scenario-files';
import { formatBytes } from '@/lib/format';

/** Откуда взят сценарий: файл с компьютера или пример из каталога репозитория. */
export type ScenarioSource =
  | { readonly kind: 'file'; readonly file: File }
  | { readonly kind: 'example'; readonly example: ScenarioExample };

export interface ParsedScenario {
  readonly document: unknown;
  /** `meta.title` файла — им предзаполняется поле «Название проекта». */
  readonly title: string;
}

/** Разобранный JSON не прошёл даже парсер: сервис такой файл не увидит. */
export class ScenarioParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScenarioParseError';
  }
}

export function sourceName(source: ScenarioSource): string {
  return source.kind === 'file' ? source.file.name : source.example.name;
}

/** Подпись под именем файла: браузер не даёт полный путь, поэтому показан размер и тип. */
export function sourceOrigin(source: ScenarioSource): string {
  return source.kind === 'file'
    ? `Файл с компьютера · ${formatBytes(source.file.size)}`
    : `Пример из каталога сценариев · ${source.example.origin}`;
}

/**
 * Чтение источника. Для файла оно повторяется при каждой проверке: кнопка «Повторить
 * проверку» существует ровно ради того, чтобы подхватить правку во внешнем редакторе.
 */
export async function readSource(source: ScenarioSource): Promise<ParsedScenario> {
  if (source.kind === 'example') {
    return { document: source.example.document, title: source.example.title };
  }

  let text: string;
  try {
    text = await source.file.text();
  } catch (cause) {
    throw new ScenarioParseError(
      'Файл больше не читается: возможно, он переименован или удалён после выбора',
      { cause },
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'неизвестная причина';
    throw new ScenarioParseError(`Файл не является корректным JSON: ${reason}`, { cause });
  }

  return { document, title: readScenarioTitle(document) };
}
