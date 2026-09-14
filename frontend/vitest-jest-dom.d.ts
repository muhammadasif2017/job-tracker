import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// jest-dom 7.0.1 augments vitest's old one-parameter `Assertion<T>`, which no
// longer merges with vitest 5's `Assertion<R, T>`. Remove once jest-dom ships
// vitest 5 types.
declare module 'vitest' {
  interface Matchers<R, T> extends TestingLibraryMatchers<unknown, R> {
    // Type-only member: merged declarations must keep vitest's `<R, T>`, and
    // lint rejects both an unused `T` and an empty interface.
    readonly __jestDomActual?: T;
  }
}
