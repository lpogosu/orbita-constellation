/**
 * Адрес файла из `public/` с учётом базового пути сборки.
 *
 * Обычная сборка живёт в корне origin, а демо на GitHub Pages — под именем репозитория.
 * Абсолютный `/assets/...` там ушёл бы в корень чужого домена, поэтому путь собирается от
 * `BASE_URL`, который Vite подставляет из `base` конфигурации (всегда с `/` на конце).
 */
export function publicPath(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
