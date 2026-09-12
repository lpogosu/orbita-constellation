const RELATIVE = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });
const ABSOLUTE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** «2 ч назад» для свежих дат и обычная дата для старых: точность важнее только вблизи. */
export function formatMoment(iso: string): string {
  const moment = new Date(iso);
  const seconds = Math.round((moment.getTime() - Date.now()) / 1000);
  const distance = Math.abs(seconds);

  if (distance >= WEEK) {
    return ABSOLUTE.format(moment);
  }
  if (distance >= DAY) {
    return RELATIVE.format(Math.round(seconds / DAY), 'day');
  }
  if (distance >= HOUR) {
    return RELATIVE.format(Math.round(seconds / HOUR), 'hour');
  }
  if (distance >= MINUTE) {
    return RELATIVE.format(Math.round(seconds / MINUTE), 'minute');
  }
  return RELATIVE.format(seconds, 'second');
}

/** Длительность сценария: часы, если горизонт кратен часу, иначе секунды как в файле. */
export function formatDuration(seconds: number): string {
  if (seconds % HOUR === 0) {
    const hours = seconds / HOUR;
    return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  }
  if (seconds % MINUTE === 0) {
    const minutes = seconds / MINUTE;
    return `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`;
  }
  return `${seconds} с`;
}

export function formatCount(value: number, one: string, few: string, many: string): string {
  return `${value} ${plural(value, one, few, many)}`;
}

export function formatBytes(bytes: number): string {
  const kilobytes = bytes / 1024;
  return kilobytes < 1024
    ? `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} КБ`
    : `${(kilobytes / 1024).toFixed(1)} МБ`;
}

/** Хэш конфигурации целиком не читается; экран показывает начало, полное — в подсказке. */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function plural(value: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(value) % 100;
  const tail = absolute % 10;
  if (absolute > 10 && absolute < 20) {
    return many;
  }
  if (tail > 1 && tail < 5) {
    return few;
  }
  return tail === 1 ? one : many;
}
