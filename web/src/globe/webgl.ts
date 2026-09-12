/**
 * Проверка перед монтированием `<Canvas>`: без неё `WebGLRenderer` бросает исключение,
 * которое роняет весь экран, а не только слот карты (`docs/18_GLOBE_3D.md`, негативный
 * случай «WebGL недоступен»).
 */
export function isWebglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
  } catch {
    return false;
  }
}
