/** Метка порядка байтов: без неё Excel читает кириллицу в CSV как вопросительные знаки. */
const BYTE_ORDER_MARK = '\u{FEFF}';

/**
 * Отдача файла пользователю. Ссылка создаётся и отзывается тут же: живой `blob:`-URL
 * держит копию файла в памяти вкладки до перезагрузки страницы, а Evidence Pack — это
 * архив на десятки мегабайт.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function saveText(text: string, fileName: string, mimeType: string): void {
  const blob = new Blob([BYTE_ORDER_MARK, text], { type: `${mimeType};charset=utf-8` });
  saveBlob(blob, fileName);
}
