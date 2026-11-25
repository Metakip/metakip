import path from 'node:path';
import stylex from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { stylexOptions } from './vite/stylexOptions';

export default defineConfig({
  plugins: [stylex.vite(stylexOptions), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'vite/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    maxWorkers: 1,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/test/setup.ts',
        'src/test/**',
        'src/main.tsx',
        'src/logger-init.ts',
        'src/index.ts',
      ],
      thresholds: {},
    },
  },
});
