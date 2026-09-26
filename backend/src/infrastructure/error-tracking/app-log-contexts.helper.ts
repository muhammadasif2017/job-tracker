/**
 * Contexts of the loggers this app created itself (ADR-053), filled by
 * `appLogger`. Deliberately free of imports: `instrument.ts` reads it through
 * `scrubLog` and must load before any module Sentry patches, `@nestjs/common`
 * included.
 *
 * Kept on `globalThis` under a registered symbol so that every copy of this
 * module shares one set: Jest's isolated module registries load it again.
 */
const APP_LOG_CONTEXTS: Set<string> = ((
  globalThis as Record<symbol, Set<string> | undefined>
)[Symbol.for('job-tracker.appLogContexts')] ??= new Set<string>());

/** Records a context as one of this app's own. */
export function registerAppLogContext(context: string) {
  APP_LOG_CONTEXTS.add(context);
}

/** True when a log line's context belongs to a logger this app created. */
export function isAppLogContext(context: unknown): boolean {
  return typeof context === 'string' && APP_LOG_CONTEXTS.has(context);
}
