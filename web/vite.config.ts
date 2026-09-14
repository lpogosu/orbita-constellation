import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { demoPages } from './vite/demo-pages';
import { scenariosDir } from './vite/scenarios-dir';

const root = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(root, '..', 'scenarios');

/**
 * `vite build --mode demo` собирает статическое демо для GitHub Pages: сайт проекта живёт
 * под именем репозитория, а ответы API берутся из записи в `demo-data/`. Остальные режимы
 * собираются в корень origin, как и раньше.
 */
const DEMO_MODE = 'demo';
const DEMO_BASE = '/orbita-constellation/';

export default defineConfig(({ mode }) => ({
  base: mode === DEMO_MODE ? DEMO_BASE : '/',
  plugins: [
    react(),
    scenariosDir(scenarios),
    ...(mode === DEMO_MODE
      ? [demoPages({ dataDir: path.resolve(root, 'demo-data'), scenariosDir: scenarios })]
      : []),
  ],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  server: {
    port: 5173,
    // В продакшене фронтенд и api видны браузеру на одном origin через nginx. Прокси
    // повторяет это в разработке, поэтому адрес api нигде не попадает в код.
    proxy: {
      '/api': {
        target: process.env['ORBITA_API_ORIGIN'] ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Сборка кладёт свои файлы в `bundle/`, чтобы не смешиваться с иллюстрациями макета
    // из `public/assets`, которые копируются в корень как есть.
    assetsDir: 'bundle',
    sourcemap: true,
    // Предупреждение о крупном файле относится к вынесенному ECharts: это одна библиотека,
    // делить её дальше нечем, и порог поднят ровно до её размера, а не отключён.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // ECharts весит больше всего остального кода вместе взятого и меняется только при
        // обновлении зависимости. Отдельным файлом он переживает выкладки приложения в
        // кэше браузера, а не выкачивается заново из-за правки одной кнопки.
        manualChunks: (id: string) => (id.includes('node_modules/echarts') ? 'echarts' : undefined),
      },
    },
  },
}));
