/**
 * Единицы показателей расчёта. Доли приходят из API в [0; 1], время — в секундах
 * (`05_API.md`), а инженер читает проценты и минуты, поэтому перевод живёт в одном месте:
 * иначе «0.9667» и «96.67 %» разойдутся между таблицей, графиком и подсказкой.
 */

/** Направление, в котором показатель считается улучшением. */
export type Better = 'up' | 'down';

const SECONDS_IN_MINUTE = 60;
const MINUTES_IN_HOUR = 60;

export function formatShare(value: number): string {
  return `${(value * 100).toFixed(2)} %`;
}

export function formatShareShort(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

/** Разница долей измеряется в процентных пунктах, а не в процентах: это разные величины. */
export function formatPoints(delta: number): string {
  return `${Math.abs(delta * 100).toFixed(2)} п.п.`;
}

/** Длительность перерыва: минуты до часа, дальше часы и минуты — как в макете. */
export function formatGap(seconds: number): string {
  const total = Math.round(Math.abs(seconds) / SECONDS_IN_MINUTE);
  if (total < MINUTES_IN_HOUR) {
    return `${total} мин`;
  }
  const hours = Math.floor(total / MINUTES_IN_HOUR);
  const minutes = total % MINUTES_IN_HOUR;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${String(minutes).padStart(2, '0')} мин`;
}

export function formatMinutes(seconds: number): number {
  return seconds / SECONDS_IN_MINUTE;
}

/** Отсчёт сетки в часы и минуты суток: общая ось шкал подписана именно так. */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds / SECONDS_IN_MINUTE);
  const hours = Math.floor(total / MINUTES_IN_HOUR);
  const minutes = total % MINUTES_IN_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
