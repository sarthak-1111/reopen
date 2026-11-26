import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Playwright's end-to-end suite (tests/e2e, *.spec.ts) runs with `npm run test:e2e`, not vitest.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    testTimeout: 60_000,
  },
});
