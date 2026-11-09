import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Property suites do substantial generated work. Keep worker contention
    // bounded and allow each property enough time on slower machines.
    maxWorkers: 4,
    testTimeout: 60_000,
  },
});
