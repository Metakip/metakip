import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const sharedFaviconDirectory = path.resolve(__dirname, '../../shared/assets/app-favicon');
const appFaviconFileNames = [
  'apple-touch-icon.png',
  'icon-dark-192.png',
  'icon-dark-512.png',
  'icon-light-192.png',
  'icon-light-512.png',
] as const;

export function appFaviconAssets(): Plugin {
  const files = appFaviconFileNames.map((fileName) => ({
    fileName,
    sourcePath: path.join(sharedFaviconDirectory, fileName),
  }));

  return {
    name: 'app-favicon-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = request.url?.split('?')[0];
        const file = files.find(({ fileName }) => requestPath === `/${fileName}`);

        if (!file) {
          next();
          return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          response.end();
          return;
        }

        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(request.method === 'HEAD' ? undefined : readFileSync(file.sourcePath));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: file.fileName,
          source: readFileSync(file.sourcePath),
        });
      }
    },
  };
}
