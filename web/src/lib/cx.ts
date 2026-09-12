/** Сборка списка классов: пустые и ложные значения отбрасываются. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}
