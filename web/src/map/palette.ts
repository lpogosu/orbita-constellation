import type { OutageCause } from '@/api/types';

/**
 * Canvas не понимает CSS-переменные, поэтому значения токенов читаются из документа один
 * раз на кадр. Так карта следует за переключением темы, не заводя второй палитры.
 */
export interface MapPalette {
  readonly client: string;
  readonly clientSelected: string;
  readonly gateway: string;
  readonly route: string;
  readonly backup: string;
  readonly failed: string;
  readonly isl: string;
  readonly groundLink: string;
  readonly label: string;
  readonly labelMuted: string;
  readonly grid: string;
  readonly planes: readonly string[];
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

export function readPalette(): MapPalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    client: token(styles, '--map-client', '#3fe9b0'),
    clientSelected: token(styles, '--map-client-selected', '#ff3d9a'),
    gateway: token(styles, '--map-gateway', '#8a3cd2'),
    route: token(styles, '--map-route', '#ff3d9a'),
    backup: token(styles, '--map-backup', '#45e3c4'),
    failed: token(styles, '--map-failed', '#ff3b4e'),
    isl: token(styles, '--map-isl', 'rgba(69, 227, 196, 0.5)'),
    groundLink: token(styles, '--map-ground-link', 'rgba(145, 132, 255, 0.45)'),
    label: token(styles, '--text-primary', '#f2f5ff'),
    labelMuted: token(styles, '--text-muted', '#7b88bc'),
    grid: token(styles, '--border-subtle', 'rgba(102, 142, 255, 0.18)'),
    // Цвета плоскостей из легенды макета; дальше список повторяется по кругу, потому что
    // число плоскостей задаёт сценарий, а не макет.
    planes: [
      token(styles, '--status-success', '#3fe9b0'),
      token(styles, '--accent-violet-light', '#9184ff'),
      token(styles, '--accent-blue', '#2e8bfb'),
      token(styles, '--map-client-selected', '#ff3d9a'),
      token(styles, '--status-warning', '#ffa05c'),
      token(styles, '--map-backup', '#45e3c4'),
    ],
  };
}

export function planeColor(palette: MapPalette, planeIds: readonly string[], planeId: string): string {
  const index = planeIds.indexOf(planeId);
  const colors = palette.planes;
  return colors[(index < 0 ? 0 : index) % colors.length] ?? colors[0] ?? '#3fe9b0';
}

/** Человеческие названия причин (`03_GLOSSARY.md` §3.1) и их цвета в шкале и легенде. */
export const CAUSE_LABEL: Record<OutageCause, string> = {
  NO_CLIENT_COVERAGE: 'Нет видимых спутников',
  GATEWAY_OUTAGE: 'Шлюз недоступен',
  NO_GATEWAY_COVERAGE: 'Нет связи со шлюзом',
  NETWORK_PARTITION: 'Разрыв межспутниковой сети',
  INTERNAL_INCONSISTENCY: 'Ошибка расчёта',
};

export const CAUSE_VARIABLE: Record<OutageCause, string> = {
  NO_CLIENT_COVERAGE: '--chart-no-client',
  GATEWAY_OUTAGE: '--chart-gateway-outage',
  NO_GATEWAY_COVERAGE: '--chart-no-gateway',
  NETWORK_PARTITION: '--chart-partition',
  INTERNAL_INCONSISTENCY: '--chart-internal',
};

export const CAUSE_ORDER: readonly OutageCause[] = [
  'NO_CLIENT_COVERAGE',
  'GATEWAY_OUTAGE',
  'NO_GATEWAY_COVERAGE',
  'NETWORK_PARTITION',
  'INTERNAL_INCONSISTENCY',
];
