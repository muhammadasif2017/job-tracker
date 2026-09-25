import { reportError } from '../infrastructure/error-tracking/error-tracking.helper.js';
import { cronRequestId, runWithRequestId } from './request-context.helper.js';

/**
 * Runs one pass of a cron job under its own correlation ID, so its log lines
 * and every job it enqueues share it (ADR-049). A failure is reported to
 * Sentry with that ID and a `cron` tag (ADR-050), then rethrown so
 * `@nestjs/schedule` still logs it.
 *
 * Every `@Cron` method wraps its body in this. Sentry's own cron capture is
 * off (see `src/instrument.ts`): it would report outside this context, with
 * no `requestId`.
 */
export async function runCronScan<T>(
  scan: string,
  work: () => Promise<T>,
): Promise<T> {
  return runWithRequestId(cronRequestId(scan), async () => {
    try {
      return await work();
    } catch (err) {
      reportError(err, { tags: { cron: scan } });
      throw err;
    }
  });
}
