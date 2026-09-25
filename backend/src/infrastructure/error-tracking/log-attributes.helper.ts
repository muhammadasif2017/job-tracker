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
  'status',
  'responseTime',
]);

/**
 * Attributes Sentry itself adds that are kept: the release, environment,
 * SDK and level. Not every `sentry.` key: `sentry.message.parameter.*` holds
 * values interpolated into a message template.
 */
const SENTRY_OWN_PREFIXES = [
  'sentry.release',
  'sentry.environment',
  'sentry.sdk.',
  'sentry.origin',
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
 * The whole `beforeSendLog` step: scrubs the attributes and, when the
 * message is the error's own text, replaces it. Pino uses `err.message` as
 * the message of a line logged with an error and no message, which is how
 * Nest's scheduler and exception handler log. That text can quote user
 * input, so it stays on the VM like the error's message attribute does.
 */
export function scrubLog<T extends SentryLogLine>(log: T): T {
  const attributes = log.attributes ?? {};
  const err = asRecord(attributes.err);
  const errText = typeof err?.message === 'string' ? err.message : '';
  const message =
    errText && typeof log.message === 'string' && log.message.includes(errText)
      ? `${typeof err?.type === 'string' ? err.type : 'Error'} (message on the VM)`
      : log.message;
  return { ...log, message, attributes: scrubLogAttributes(attributes) };
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
