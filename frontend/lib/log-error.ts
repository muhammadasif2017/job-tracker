import { captureException } from '@sentry/browser';

/**
 * Logs an error caught by a Next.js error boundary with enough context to act
 * on.
 *
 * Shared by the three error boundaries (`app/error.tsx`,
 * `app/(dashboard)/error.tsx`, `app/global-error.tsx`). It writes to the
 * console, so a screenshot is enough to act on (which boundary caught it,
 * what the user was looking at, and the `digest` that ties a production
 * error back to the server-side stack Next.js logged and stripped from the
 * client bundle), and reports to Sentry with the same boundary and digest
 * (ADR-051). The report is a no-op when no DSN is set.
 */
export function logBoundaryError(
  error: Error & { digest?: string },
  boundary: string,
) {
  console.error(
    `[${boundary}]`,
    {
      message: error.message,
      digest: error.digest,
      // Guarded because `global-error.tsx` also covers root-layout failures, and
      // the effect body is the only place in these files that touches `window`.
      path:
        typeof window === 'undefined' ? undefined : window.location.pathname,
      at: new Date().toISOString(),
      // The error object last, so devtools still renders the expandable stack.
    },
    error,
  );
  captureException(error, {
    tags: { boundary },
    extra: { digest: error.digest },
  });
}
