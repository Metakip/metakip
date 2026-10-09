import { createRequire } from 'node:module';
import { defineConfig } from 'astro/config';

const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro'));

export default defineConfig({
  site: 'https://metakip.com',
  output: 'static',
  vite: {
    // Resolve Astro's own dependency instead of an unrelated cookie package in an ancestor folder.
    resolve: { alias: { cookie: astroRequire.resolve('cookie') } },
  },
  server: {
    port: 8888,
  },
});
