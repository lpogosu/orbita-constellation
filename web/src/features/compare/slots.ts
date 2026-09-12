/** Позиционные имена вариантов сравнения: ими подписаны и карточки, и столбцы таблицы. */
export const SLOT_LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * Цвет слота — один и тот же у карточки варианта, у столбика на графике и у полосы на
 * шкале: сопоставление идёт глазом, и разные палитры в трёх блоках его ломают.
 * Хранятся имена переменных, а не значения: график рисует SVG и цвет ему нужен значением,
 * которое зависит от темы.
 */
export const SLOT_TOKENS = [
  '--chart-ok',
  '--accent-violet-light',
  '--accent-blue',
  '--chart-no-gateway',
] as const;

export function slotToken(index: number): string {
  return SLOT_TOKENS[index % SLOT_TOKENS.length] ?? '--chart-ok';
}

export function slotColor(index: number): string {
  return `var(${slotToken(index)})`;
}

export function slotLetter(index: number): string {
  return SLOT_LETTERS[index % SLOT_LETTERS.length] ?? '?';
}
