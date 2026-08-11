import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e/ holds Playwright specs (run via `npm run test:e2e`), not vitest
    // tests - vitest's default include glob would otherwise pick them up
    // too and collide with Playwright's own test()/describe() globals.
    exclude: ['node_modules/**', 'e2e/**'],
  },
});
