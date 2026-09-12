/** Ключ строки списка отказов: вид объекта и позиция в своём массиве сценария. */
export function rowKey(kind: 'satellite' | 'gateway', index: number): string {
  return `${kind}:${index}`;
}

/** Доля [0; 1] → пункты процента со знаком: так дельты читаются в докладе. */
export function formatPoints(delta: number): string {
  const points = delta * 100;
  const sign = points > 0 ? '+' : points < 0 ? '−' : '';
  return `${sign}${Math.abs(points).toFixed(2)} п.п.`;
}
