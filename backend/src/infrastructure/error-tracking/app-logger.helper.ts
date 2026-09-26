import { Logger } from '@nestjs/common';

/**
 * Contexts of the loggers this app created itself, filled by `appLogger`.
 * Kept on `globalThis` under a registered symbol so that every copy of this
 * module shares one set: `instrument.ts` loads before the app, and Jest's
 * isolated module registries load it again.
 */
const APP_LOG_CONTEXTS: Set<string> = ((
  globalThis as Record<symbol, Set<string> | undefined>
)[Symbol.for('job-tracker.appLogContexts')] ??= new Set<string>());

/**
 * Creates the logger a class in this app writes with: Nest's `Logger`,
 * whose context is the class name, recorded as one of our own (ADR-053).
 * Only lines from these contexts go to Sentry Logs. A line from Nest core,
 * the scheduler, Terminus or pino-http has a context we never registered (or
 * a stack trace filed as the context), and those libraries put error text in
 * their messages, so their lines stay on the VM. Their failures still reach
 * Sentry Issues through `GlobalExceptionFilter` and `runCronScan`.
 *
 * Use it wherever you would write `new Logger(ClassName.name)`.
 */
export function appLogger(owner: { name: string }): Logger {
  APP_LOG_CONTEXTS.add(owner.name);
  return new Logger(owner.name);
}

/** True when a log line's context belongs to a logger `appLogger` created. */
export function isAppLogContext(context: unknown): boolean {
  return typeof context === 'string' && APP_LOG_CONTEXTS.has(context);
}
