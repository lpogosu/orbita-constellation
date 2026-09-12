/**
 * Цвет слота сравнения — один и тот же у карточки варианта, у столбика на графике и у
 * полосы на шкале: сопоставление идёт глазом, и три разные палитры в трёх блоках его ломают.
 * Хранятся имена переменных, а не значения: график рисует SVG сам, цвет ему нужен значением,
 * а значение зависит от темы.
 *
 * Буква слота берётся из `variantLetter` (`lib/run-format.ts`) — той же, которой варианты
 * подписаны на экранах «Проект» и «Результат».
 */
const SLOT_TOKENS = [
  '--chart-ok',
  '--accent-violet-light',
  '--accent-blue',
  '--chart-no-gateway',
] as const;

export const MAX_SLOTS = SLOT_TOKENS.length;

export function slotToken(index: number): string {
  return SLOT_TOKENS[index % SLOT_TOKENS.length] ?? '--chart-ok';
}

export function slotColor(index: number): string {
  return `var(${slotToken(index)})`;
}
