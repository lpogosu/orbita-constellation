import type { ComparisonEntry } from '@/api/types';
import { metricSections } from './metrics';
import { variantLetter } from '@/lib/run-format';

/**
 * «Скачать сравнение CSV» из `14_SCREENS.md` §6. Отдельного endpoint под это нет, а числа
 * в файле — ровно те, что уже показаны в таблице: пересчитывать их браузер не начинает,
 * он только меняет формат. Разделитель — точка с запятой: Excel в русской локали делит
 * строку по ней, а запятая внутри десятичной дроби ломает разбор.
 */
export function comparisonCsv(entries: readonly ComparisonEntry[]): string {
  const base = entries[0];
  if (base === undefined) {
    return '';
  }

  const header = ['Метрика'];
  for (const [index, entry] of entries.entries()) {
    header.push(`${variantLetter(index)} · ${entry.variant_title}`);
    if (index > 0) {
      header.push(`Δ ${variantLetter(index)}`);
    }
  }

  const lines = [header];
  for (const section of metricSections(base)) {
    lines.push([section.title]);
    for (const row of section.rows) {
      const line = [row.title];
      for (const [index, entry] of entries.entries()) {
        const cell = row.cell(entry, base);
        line.push(cell.value);
        if (index > 0) {
          line.push(cell.delta ?? '');
        }
      }
      lines.push(line);
    }
  }

  return lines.map((line) => line.map(escape).join(';')).join('\r\n');
}

function escape(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
