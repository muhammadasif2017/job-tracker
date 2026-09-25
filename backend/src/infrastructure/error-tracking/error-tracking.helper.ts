import * as Sentry from '@sentry/nestjs';
import { currentRequestId } from '../../common/request-context.helper.js';

/** What an error report is tagged with, beyond the error itself. */
export interface ErrorReportContext {
  /** Correlation ID; defaults to the one in the current request or job context. */
  requestId?: string;
  /** The signed-in user's ID. Never their email or name. */
  userId?: string;
  /** Searchable fields, such as the queue a job ran on. */
  tags?: Record<string, string>;
  /** Unsearchable detail shown on the event. */
  extra?: Record<string, unknown>;
  /**
   * The event's title in Sentry, such as `GET /v1/jobs/:id`. Without spans the
   * SDK can only name an event by its raw path, which carries record IDs and
   * splits one route into many titles.
   */
  transaction?: string;
}

/**
 * Sends an unexpected error to Sentry, tagged with the correlation ID so the
 * event links to the matching log lines (ADR-049, ADR-050). A no-op when
 * Sentry is not initialized (no `SENTRY_DSN`), so callers never need to check.
 */
export function reportError(err: unknown, context: ErrorReportContext = {}) {
  const requestId = context.requestId ?? currentRequestId();
  Sentry.withScope((scope) => {
    if (requestId) scope.setTag('requestId', requestId);
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.tags) scope.setTags(context.tags);
    if (context.extra) scope.setExtras(context.extra);
    if (context.transaction) scope.setTransactionName(context.transaction);
    Sentry.captureException(err);
  });
}
