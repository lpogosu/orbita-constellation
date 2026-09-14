import { access, copyFile, cp, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Plugin } from 'vite';

import { listDirectory } from './scenarios-dir';

interface DemoPagesOptions {
  /** Каталог записи `scripts/record_demo.py` с `index.json` и файлами ответов. */
  readonly dataDir: string;
  /** Каталог `scenarios/` репозитория: примеры на экране «Проекты». */
  readonly scenariosDir: string;
}

/**
 * Дополняет сборку демо тем, что в образе отдаёт nginx, а на GitHub Pages взять неоткуда.
 *
 * - `demo-data/` — записанные ответы API; без них демо показывало бы только ошибки, поэтому
 *   их отсутствие останавливает сборку, а не выясняется в браузере.
 * - `scenarios/` — файлы примеров и готовый список каталога: автоиндекса у Pages нет.
 * - `404.html` — копия `index.html`. Pages отдаёт её на любой неизвестный путь, и глубокая
 *   ссылка вроде `/network/<проект>` открывает приложение, а роутер разбирает адрес сам.
 */
export function demoPages({ dataDir, scenariosDir }: DemoPagesOptions): Plugin {
  let outDir = '';

  return {
    name: 'orbita-demo-pages',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      try {
        await access(path.join(dataDir, 'index.json'));
      } catch {
        this.error(
          `Нет записи демо в ${dataDir}: сначала поднимите стек и запустите python scripts/record_demo.py`,
        );
      }
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'scenarios/index.json',
        source: await listDirectory(scenariosDir),
      });
      const entries = await readdir(scenariosDir, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isFile())) {
        this.emitFile({
          type: 'asset',
          fileName: `scenarios/${entry.name}`,
          source: await readFile(path.join(scenariosDir, entry.name)),
        });
      }
    },
    async writeBundle() {
      await cp(dataDir, path.join(outDir, 'demo-data'), { recursive: true });
      await copyFile(path.join(outDir, 'index.html'), path.join(outDir, '404.html'));
    },
  };
}
