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
 * client bundle). It also reports client-side errors to Sentry, tagged with
 * the boundary (ADR-051). The report is a no-op when no DSN is set.
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
  // A digest means the error came from the server, and `onRequestError` in
  // instrumentation.ts already reported the real one. The browser only has a
  // sanitised copy, and every such copy would group into one issue.
  if (error.digest) return;
  captureException(error, { tags: { boundary } });
}
