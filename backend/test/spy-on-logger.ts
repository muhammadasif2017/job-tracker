import { Logger } from '@nestjs/common';

/**
 * Spies on Nest's `Logger` and silences it, for specs of services that log
 * through `new Logger(ClassName.name)` (ADR-053). Assert on the returned
 * spies: each receives the call's own arguments, `({ fields }, 'message')`,
 * without the context, which Nest adds later.
 *
 * `jest.clearAllMocks()` in a `beforeEach` resets the recorded calls and
 * keeps the silencing; `restoreAllMocks` would bring back real output.
 */
export function spyOnLogger() {
  const silent = () => undefined;
  return {
    log: jest.spyOn(Logger.prototype, 'log').mockImplementation(silent),
    warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(silent),
    error: jest.spyOn(Logger.prototype, 'error').mockImplementation(silent),
    debug: jest.spyOn(Logger.prototype, 'debug').mockImplementation(silent),
  };
}
