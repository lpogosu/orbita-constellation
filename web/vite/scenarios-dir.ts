import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Plugin } from 'vite';

/**
 * В контейнере каталог сценариев отдаёт nginx: `autoindex_format json` для `/scenarios/`
 * и сами файлы рядом. Плагин повторяет оба ответа в `vite dev`, чтобы список примеров в
 * браузере и в собранном образе приходил из одного источника — каталога `scenarios/`
 * репозитория, а не из зашитого в код перечня имён.
 */
export function scenariosDir(directory: string): Plugin {
  const prefix = '/scenarios/';

  return {
    name: 'orbita-scenarios-dir',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '';
        if (!url.startsWith(prefix)) {
          next();
          return;
        }

        const name = decodeURIComponent(url.slice(prefix.length).split('?')[0] ?? '');

        if (name === '') {
          void listDirectory(directory)
            .then((body) => {
              response.setHeader('Content-Type', 'application/json; charset=utf-8');
              response.end(body);
            })
            .catch(next);
          return;
        }

        // Имя приходит из адресной строки: сегменты пути отрезают выход за каталог.
        if (name !== path.basename(name)) {
          response.statusCode = 403;
          response.end();
          return;
        }

        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        createReadStream(path.join(directory, name))
          .on('error', () => {
            response.statusCode = 404;
            response.end();
          })
          .pipe(response);
      });
    },
  };
}

async function listDirectory(directory: string): Promise<string> {
  const names = await readdir(directory);
  const entries = await Promise.all(
    names.map(async (name) => {
      const info = await stat(path.join(directory, name));
      return { name, type: info.isDirectory() ? 'directory' : 'file', size: info.size };
    }),
  );
  return JSON.stringify(entries);
}
