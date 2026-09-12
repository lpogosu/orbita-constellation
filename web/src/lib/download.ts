import { ApiError, TransportError } from '@/api/client';
import type { ErrorDetail } from '@/api/types';

/**
 * Сохранение ответа endpoint в файл.
 *
 * Ссылку `<a href download>` использовать нельзя: имя файла тогда диктует сервер, а
 * `GET /api/variants/{id}/export` отдаёт сценарий без `Content-Disposition` — браузер
 * открыл бы его во вкладке. Поэтому ответ читается как blob, и имя задаётся здесь.
 * Ошибка приходит тем же конвертом, что у остальных запросов (`05_API.md` §3), и
 * разбирается так же, чтобы блок показал сообщение сервиса, а не «не удалось скачать».
 */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch (cause) {
    throw new TransportError('Сервис недоступен: проверьте, что стек запущен', { cause });
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = errorDetail(body);
    throw new ApiError(
      response.status,
      detail === null ? [] : [detail],
      detail?.message ?? `Файл не отдан (HTTP ${response.status})`,
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function errorDetail(body: unknown): ErrorDetail | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const envelope = body as { error?: unknown };
  return typeof envelope.error === 'object' && envelope.error !== null
    ? (envelope.error as ErrorDetail)
    : null;
}

/**
 * Имя выгрузки по `14_SCREENS.md` §4: `<проект>_<вариант>_<политика>.json`. Пробелы и
 * разделители пути в названиях проекта и варианта заменяются, иначе файл не сохранится.
 */
export function exportFileName(parts: readonly string[], extension: string): string {
  return `${parts.map(safePart).join('_')}.${extension}`;
}

function safePart(part: string): string {
  return part.trim().replace(/[\s/\\:*?"<>|]+/g, '-');
}

/** Метка порядка байтов: без неё Excel читает кириллицу в CSV как вопросительные знаки. */
const BYTE_ORDER_MARK = '\u{FEFF}';

/** Сохранение текста, собранного на экране: таблица сравнения в CSV (`14_SCREENS.md` §6). */
export function saveText(text: string, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(
    new Blob([BYTE_ORDER_MARK, text], { type: `${mimeType};charset=utf-8` }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
