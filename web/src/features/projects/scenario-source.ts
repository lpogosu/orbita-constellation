import type { ScenarioExample } from '@/api/scenario-files';
import { readScenarioTitle } from '@/api/scenario-files';
import { formatBytes } from '@/lib/format';

/** Откуда взят сценарий: файл с компьютера или пример из каталога репозитория. */
export type ScenarioSource =
  | { readonly kind: 'file'; readonly file: File }
  | { readonly kind: 'example'; readonly example: ScenarioExample }
  /** Исправленная пользователем версия файла: браузер не умеет перезаписать исходный File. */
  | { readonly kind: 'inline'; readonly name: string; readonly text: string };

export interface ParsedScenario {
  readonly document: unknown;
  readonly text: string;
  /** `meta.title` файла — им предзаполняется поле «Название проекта». */
  readonly title: string;
}

/** Разобранный JSON не прошёл даже парсер: сервис такой файл не увидит. */
export class ScenarioParseError extends Error {
  readonly sourceText: string | null;

  constructor(message: string, options?: { cause?: unknown; sourceText?: string }) {
    super(message, options);
    this.name = 'ScenarioParseError';
    this.sourceText = options?.sourceText ?? null;
  }
}

export function sourceName(source: ScenarioSource): string {
  if (source.kind === 'file') {
    return source.file.name;
  }
  return source.kind === 'example' ? source.example.name : source.name;
}

/** Подпись под именем файла: браузер не даёт полный путь, поэтому показан размер и тип. */
export function sourceOrigin(source: ScenarioSource): string {
  if (source.kind === 'file') {
    return `Файл с компьютера · ${formatBytes(source.file.size)}`;
  }
  return source.kind === 'example'
    ? 'Пример из каталога сценариев репозитория'
    : 'Исправлено во встроенном редакторе JSON';
}

/**
 * Чтение источника. Для файла оно повторяется при каждой проверке: кнопка «Повторить
 * проверку» существует ровно ради того, чтобы подхватить правку во внешнем редакторе.
 */
export async function readSource(source: ScenarioSource): Promise<ParsedScenario> {
  const text = await readSourceText(source);

  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'неизвестная причина';
    throw new ScenarioParseError(`Файл не является корректным JSON: ${reason}`, {
      cause,
      sourceText: text,
    });
  }

  return { document, text, title: readScenarioTitle(document) };
}

export async function readSourceText(source: ScenarioSource): Promise<string> {
  if (source.kind === 'example') {
    return JSON.stringify(source.example.document, null, 2);
  }
  if (source.kind === 'inline') {
    return source.text;
  }
  try {
    return await source.file.text();
  } catch (cause) {
    throw new ScenarioParseError(
      'Файл больше не читается: возможно, он переименован или удалён после выбора',
      { cause },
    );
  }
}
