import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turn off ESLint rules that conflict with Prettier (must come last).
  eslintConfigPrettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    // Downgrade advisory rules to warnings: `any` in catch/error handling and
    // localStorage-driven setState in effects (theme init) are intentional.
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Session teardown assigns `window.location.href` on purpose (see
    // CONSTRAINTS.md E5). A full document load is what discards the TanStack
    // Query cache and the Zustand store, so one user's data cannot outlive
    // their session on a shared browser; `router.push` keeps both alive. In
    // `lib/api.ts` there is no router to reach anyway — it is an axios
    // interceptor at module scope. Scoped to these three files, so the rule
    // still guards every other navigation. Each call site states its reason.
    files: [
      'components/layout/sidebar.tsx',
      'features/profile/hooks.ts',
      'lib/api.ts',
    ],
    rules: {
      '@next/next/no-location-assign-relative-destination': 'off',
    },
  },
]);

export default eslintConfig;
