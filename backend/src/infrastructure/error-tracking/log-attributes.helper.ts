/**
 * Log fields that may leave the VM for Sentry Logs (ADR-053). An allowlist,
 * not a denylist: a log line can carry anything a developer passed to it,
 * such as the `to` address the email service logs. A new field stays on the
 * VM until someone adds it here on purpose.
 */
const SENT_LOG_FIELDS = new Set([
  'requestId',
  'context',
  'jobId',
  'companyId',
  'roundId',
  'queue',
  'model',
  'status',
  'responseTime',
]);

/** Prefixes of the attributes Sentry itself adds (release, SDK, level). */
const SENTRY_OWN_PREFIXES = ['sentry.', 'pino.'];

/**
 * Reduces a pino log line's fields to what Sentry may store. From `req` it
 * keeps only the method and the path without the query string (search terms
 * live there); from `res` only the status code; from `err` its type,
 * message and stack. Headers, cookies, bodies and every field not in the
 * allowlist are dropped.
 */
export function scrubLogAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (
      SENT_LOG_FIELDS.has(key) ||
      SENTRY_OWN_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      kept[key] = value;
    }
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
  for (const field of ['type', 'message', 'stack'] as const) {
    if (typeof err?.[field] === 'string') kept[`error.${field}`] = err[field];
  }

  return kept;
}

/** The value as a plain object, or undefined when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
