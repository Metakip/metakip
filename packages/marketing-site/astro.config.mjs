import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://metakip.com',
  output: 'static',
  server: {
    port: 8888,
  },
});
