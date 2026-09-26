import type { LogFn, Logger as PinoLogger } from 'pino';
import { isAppLogContext } from './app-logger.helper.js';

/**
 * Log fields that may leave the VM for Sentry Logs (ADR-053). An allowlist,
 * not a denylist: a log line can carry anything a developer passed to it,
 * such as the `to` address the email service logs. A new field stays on the
 * VM until someone adds it here on purpose. IDs only, never names or
 * addresses.
 */
const SENT_LOG_FIELDS = new Set([
  'requestId',
  'context',
  'jobId',
  'companyId',
  'roundId',
  'userId',
  'queue',
  'model',
  'phase',
  'errorName',
  'outageMs',
  'status',
  'responseTime',
]);

/**
 * Attributes Sentry itself adds that are kept: the release, environment,
 * SDK, level, and the trace links that attach a line to its span in the
 * trace view. Not every `sentry.` key: `sentry.message.parameter.*` holds
 * values interpolated into a message template.
 */
const SENTRY_OWN_PREFIXES = [
  'sentry.release',
  'sentry.environment',
  'sentry.sdk.',
  'sentry.origin',
  'sentry.trace.',
  'sentry.replay_id',
  'pino.',
];

/**
 * Reduces a pino log line's fields to what Sentry may store.
 *
 * - An allowlisted field passes only as a string, number or boolean. An
 *   object under an allowed key could carry anything: nestjs-pino files the
 *   last extra argument of `logger.warn('msg', { to })` under `context`.
 * - From `req` it keeps the method and the path without the query string,
 *   where search terms live; from `res` the status code.
 * - From `err` only the type. Its message and stack can quote user input,
 *   and the error events in Sentry Issues already carry them.
 * - Headers, cookies, bodies and every other field are dropped.
 */
export function scrubLogAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const allowed =
      SENT_LOG_FIELDS.has(key) ||
      SENTRY_OWN_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (allowed && isPrimitive(value)) kept[key] = value;
  }

  const req = asRecord(attributes.req);
  if (typeof req?.method === 'string') {
    kept['http.request.method'] = req.method;
  }
  if (typeof req?.url === 'string') {
    kept['url.path'] = req.url.split('?')[0];
  }

  const res = asRecord(attributes.res);
  if (typeof res?.statusCode === 'number') {
    kept['http.response.status_code'] = res.statusCode;
  }

  const err = asRecord(attributes.err);
  if (typeof err?.type === 'string') kept['error.type'] = err.type;

  return kept;
}

/** The shape of a log line as `beforeSendLog` receives it. */
interface SentryLogLine {
  message: unknown;
  attributes?: Record<string, unknown>;
}

/**
 * The whole `beforeSendLog` step (ADR-053). Drops the line unless it came
 * from a logger this app created (`appLogger`): Nest core, the scheduler,
 * Terminus and pino-http write their own messages, which can carry error
 * text or a stack, and no allowlist of fields can clean a message. For our
 * own lines it scrubs the attributes and, as a fallback, replaces a message
 * that is exactly the error's text.
 */
export function scrubLog<T extends SentryLogLine>(log: T): T | null {
  const attributes = log.attributes ?? {};
  if (!isAppLogContext(attributes.context)) return null;
  const err = asRecord(attributes.err);
  const errType = typeof err?.type === 'string' ? err.type : 'Error';
  const message = isErrorText(log.message, err?.message)
    ? `${errType} (message on the VM)`
    : log.message;
  return { ...log, message, attributes: scrubLogAttributes(attributes) };
}

/**
 * True when a log message is exactly the error's text. A fallback only:
 * `fixedMessageForBareErrors` already stops pino filling a message in from
 * the error, including for errors with causes. Exact equality, because
 * anything looser also swallows fixed messages we wrote ('Failed to send
 * email' for an error reading 'Failed to send email: ...').
 */
function isErrorText(message: unknown, errMessage: unknown): boolean {
  return (
    typeof message === 'string' && message !== '' && message === errMessage
  );
}

/** True for the value kinds a log attribute may carry out of the VM. */
function isPrimitive(value: unknown): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

/** The value as a plain object, or undefined when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The message given to a line logged with an error and no message. */
export const ERROR_WITHOUT_MESSAGE = 'Error logged without a message';

/**
 * Pino `hooks.logMethod` (set in `AppModule`): gives a line logged with only
 * an error a fixed message. Otherwise pino uses the error's own text as the
 * message, which is how Nest's scheduler and exception handler log
 * (`logger.error(err)`), and that text can quote user input. This fixes it
 * where the line is written; `scrubLog`'s comparison is the fallback. The
 * error itself is still logged in full under `err` on the VM.
 */
export function fixedMessageForBareErrors(
  this: PinoLogger,
  args: Parameters<LogFn>,
  method: LogFn,
): void {
  // Nest's `Logger.error(err)` pads its arguments, so nestjs-pino calls
  // `pino.error({ context, err }, undefined)`: trailing undefineds do not
  // count as a message.
  const given = (args as unknown[]).filter(
    (arg, i) => i === 0 || arg !== undefined,
  );
  const [first] = given;
  if (given.length === 1 && first instanceof Error) {
    method.apply(this, [{ err: first }, ERROR_WITHOUT_MESSAGE]);
    return;
  }
  if (given.length === 1 && asRecord(first) && 'err' in (first as object)) {
    method.apply(this, [first as object, ERROR_WITHOUT_MESSAGE]);
    return;
  }
  method.apply(this, args);
}
