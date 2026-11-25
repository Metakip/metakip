import path from 'node:path';
import stylex from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { appFaviconAssets } from './vite/appFaviconAssets';
import { copyEmojiData } from './vite/emojiDataPlugin';
import { stylexOptions } from './vite/stylexOptions';

const monorepoRoot = path.resolve(__dirname, '../../');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, monorepoRoot, '');

  return {
    envDir: monorepoRoot,
    plugins: [stylex.vite(stylexOptions), react(), copyEmojiData(), appFaviconAssets()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('katex')) return 'editor';
              if (id.includes('yjs') || id.includes('@hocuspocus')) {
                return 'collab';
              }

              if (id.includes('react') || id.includes('react-dom')) {
                return 'react';
              }
            }
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_URL ?? 'http://localhost:3001',
          changeOrigin: true,
        },
        '/collab': {
          target: 'http://localhost:1234',
          ws: true,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/collab/, ''),
        },
      },
    },
  };
});
