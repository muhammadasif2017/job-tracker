import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: [
        'app/**',
        'components/**',
        'features/**',
        'lib/**',
        'store/**',
        'proxy.ts',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', 'types/api.generated.ts'],
    },
  },
});
