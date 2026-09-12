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

/**
 * Значения читаются функцией из `useTokenColors`: она пересчитывает их при смене темы,
 * поэтому карта перекрашивается вместе с интерфейсом, а не остаётся в цветах прошлой.
 */
export function readPalette(read: (name: string) => string): MapPalette {
  const token = (name: string, fallback: string): string => {
    const value = read(name);
    return value === '' ? fallback : value;
  };
  return {
    client: token('--map-client', '#3fe9b0'),
    clientSelected: token('--map-client-selected', '#ff3d9a'),
    gateway: token('--map-gateway', '#8a3cd2'),
    route: token('--map-route', '#ff3d9a'),
    backup: token('--map-backup', '#45e3c4'),
    failed: token('--map-failed', '#ff3b4e'),
    isl: token('--map-isl', 'rgba(69, 227, 196, 0.5)'),
    groundLink: token('--map-ground-link', 'rgba(145, 132, 255, 0.45)'),
    label: token('--text-primary', '#f2f5ff'),
    labelMuted: token('--text-muted', '#7b88bc'),
    grid: token('--border-subtle', 'rgba(102, 142, 255, 0.18)'),
    // Цвета плоскостей из легенды макета; дальше список повторяется по кругу, потому что
    // число плоскостей задаёт сценарий, а не макет.
    planes: [
      token('--status-success', '#3fe9b0'),
      token('--accent-violet-light', '#9184ff'),
      token('--accent-blue', '#2e8bfb'),
      token('--map-client-selected', '#ff3d9a'),
      token('--status-warning', '#ffa05c'),
      token('--map-backup', '#45e3c4'),
    ],
  };
}

export function planeColor(palette: MapPalette, planeIds: readonly string[], planeId: string): string {
  const index = planeIds.indexOf(planeId);
  const colors = palette.planes;
  return colors[(index < 0 ? 0 : index) % colors.length] ?? colors[0] ?? '#3fe9b0';
}
