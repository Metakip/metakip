import { defineConfig } from 'vitest/config';

const coverageConfig = {
  enabled: true,
  provider: 'v8' as const,
  reporter: ['text', 'json-summary', 'html', 'lcov'] as string[],
  reportsDirectory: './coverage',
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/*.test.ts',
    'src/**/*.unit.test.ts',
    'src/**/*.bench.ts',
    'src/index.ts',
    'src/env.ts',
    'src/db/**',
    'src/auth.ts',
    'src/routes/auth.ts',
  ],
  thresholds: {},
};

export default defineConfig({
  test: {
    name: '@metakip/api',
    hookTimeout: 180_000,
    testTimeout: 60_000,
    globals: true,
    environment: 'node',
    coverage: coverageConfig,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.unit.test.ts'],
          pool: 'threads',
          setupFiles: ['./test/unit-setup.ts'],
          coverage: coverageConfig,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.unit.test.ts'],
          pool: 'threads',
          isolate: true,
          fileParallelism: false,
          maxWorkers: 1,
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/setup.ts'],
          hookTimeout: 180_000,
          testTimeout: 60_000,
          coverage: coverageConfig,
        },
      },
    ],
  },
});
