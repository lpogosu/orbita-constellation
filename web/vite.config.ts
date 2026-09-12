import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { scenariosDir } from './vite/scenarios-dir';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), scenariosDir(path.resolve(root, '..', 'scenarios'))],
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
});
