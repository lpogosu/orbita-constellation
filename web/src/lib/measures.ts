/**
 * Величины, которых нет в `run-format.ts`: отклонения от базы и короткая доля для ячеек
 * тепловой карты. Общие форматы — доля, перерыв, отсчёт, политика, буква варианта — живут
 * там, и дублировать их здесь нельзя: две записи одного числа на соседних экранах читаются
 * как расхождение расчёта.
 */

/** Направление, в котором показатель считается улучшением. */
export type Better = 'up' | 'down';

/** Доля с одним знаком: в ячейке тепловой карты второй знак не помещается и не нужен. */
export function formatShareShort(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

/** Разница долей измеряется в процентных пунктах, а не в процентах: это разные величины. */
export function formatPoints(delta: number): string {
  return `${Math.abs(delta * 100).toFixed(2)} п.п.`;
}

export function formatDecimal(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** Стрелка показывает знак числа, а цвет — пользу: рост перерыва растёт и вредит. */
export function deltaArrow(delta: number): string {
  if (delta > 0) {
    return '▲';
  }
  return delta < 0 ? '▼' : '=';
}

export function deltaTone(delta: number, better: Better): 'good' | 'bad' | 'flat' {
  if (delta === 0) {
    return 'flat';
  }
  const improved = better === 'up' ? delta > 0 : delta < 0;
  return improved ? 'good' : 'bad';
}
