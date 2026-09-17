import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'prisma/**',
      '**/*.config.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    // The integration suite shares a single SQLite file. Running test files in
    // parallel causes cross-file data races (unique/FK violations). Execute
    // files sequentially for deterministic results.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // PostCSS'i devre dışı bırak
    css: {
      include: [],
    },
  },
  // PostCSS plugin'lerini devre dışı bırak
  css: {
    postcss: {
      plugins: [],
    },
  },
});
