import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['unit/**/*.test.ts', 'e2e/**/*.test.ts'],
    globals: true,
    testTimeout: 60000,
  },
});
