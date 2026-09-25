import type { ErrorEvent } from '@sentry/nextjs';

/**
 * The frontend's Sentry DSN (ADR-051). Unset or empty means error tracking is
 * off, so local runs, the unit tests and the Playwright suite send nothing.
 * Not a secret: a DSN only lets a client send events to its project.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;

/**
 * Same-origin path the browser sends events to; `withSentryConfig`'s
 * `tunnelRoute` forwards them to Sentry, so ad blockers that block sentry.io
 * don't drop them. `proxy.ts` must not intercept it.
 */
export const SENTRY_TUNNEL_ROUTE = '/monitoring';

/**
 * Removes the sender's IP address from an event before it leaves the
 * browser. Browser events come from users' own machines, so the IP is
 * personal data. The project also has "Prevent Storing of IP Addresses" on;
 * this makes the code not depend on that setting staying on.
 */
export function withoutIpAddress(event: ErrorEvent): ErrorEvent {
  if (event.user) delete event.user.ip_address;
  return event;
}

/**
 * The init options every runtime shares: browser, Node server and edge
 * (ADR-051). Kept in one place so the privacy settings cannot drift between
 * them.
 *
 * - Errors only: no tracing, replay or feedback.
 * - Nothing personal: the SDK's v11 defaults would collect cookies, headers,
 *   bodies, query params and user info. All of that is off, along with
 *   stack-frame variables, which can hold tokens. `beforeSend` strips the IP.
 */
export function sharedSentryOptions() {
  return {
    dsn: SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ||
      process.env.NODE_ENV ||
      'development',
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend: withoutIpAddress,
  };
}
