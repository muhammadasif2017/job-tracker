import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

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
 * The browser's tunnel URL for a DSN. `withSentryConfig`'s rewrite only
 * matches `/monitoring?o=<org>&p=<project>[&r=<region>]`, and only
 * `@sentry/nextjs`'s own client init adds that query. The browser here runs
 * plain `@sentry/browser`, so it builds the same URL itself. A DSN that is
 * not Sentry SaaS gets no tunnel and sends directly.
 */
export function tunnelFor(dsn: string): string | undefined {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return undefined;
  }
  const saas = url.hostname.match(
    /^o(\d+)\.ingest(?:\.([a-z]{2}))?\.sentry\.io$/,
  );
  const projectId = url.pathname.replace(/^\//, '');
  if (!saas || !/^\d+$/.test(projectId)) return undefined;
  const region = saas[2] ? `&r=${saas[2]}` : '';
  return `${SENTRY_TUNNEL_ROUTE}?o=${saas[1]}&p=${projectId}${region}`;
}

/**
 * Drops the query string from navigation breadcrumbs. They record full URLs,
 * such as `/callback?code=...` with the one-time OAuth code, and
 * `dataCollection.urlQueryParams` does not cover breadcrumbs.
 */
export function withoutNavigationQuery(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== 'navigation' || !breadcrumb.data) {
    return breadcrumb;
  }
  const data = { ...breadcrumb.data };
  for (const key of ['from', 'to']) {
    if (typeof data[key] === 'string') data[key] = data[key].split('?')[0];
  }
  return { ...breadcrumb, data };
}

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
 * The init options every runtime shares: the browser and the Node server
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
