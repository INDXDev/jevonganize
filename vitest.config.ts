import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test process can start its own parser pool and external converters.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/ai/**'],
      thresholds: { lines: 80 },
    },
  },
});
