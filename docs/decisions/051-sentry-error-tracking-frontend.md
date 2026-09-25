# ADR-051: Sentry error tracking for the frontend

## Status

Accepted

## Date

2026-09-25

## Context

ADR-050 reports backend errors to Sentry. A crash in the browser, or in a
server component on Vercel, still reached nobody: `logBoundaryError` wrote
to the user's own console and Vercel's function logs kept the rest.

## Decision

Report frontend errors to Sentry (project `job-tracker-frontend`), in all
three Next.js runtimes, only when `NEXT_PUBLIC_SENTRY_DSN` is set. Local
runs, the unit tests, CI and the Playwright suite send nothing.

- **Browser: `@sentry/browser`, not `@sentry/nextjs`.**
  `instrumentation-client.ts` starts a minimal client with
  `defaultIntegrations: false`. It loads only uncaught-error and rejection
  handlers, linked causes, de-duplication and click/navigation breadcrumbs.
  `@sentry/nextjs`'s browser `init` statically imports tracing and its other
  default integrations, and Turbopack does not tree-shake them.
- **Server: `@sentry/nextjs`.** `instrumentation.ts` loads
  `sentry.server.config.ts` and exports `onRequestError`, so errors in
  server components, route handlers and `proxy.ts` are reported. There is no
  edge config: in Next 16 `proxy.ts` always runs on Node.js, and no route
  opts into the edge runtime.
- **Error boundaries report.** `logBoundaryError` (used by `app/error.tsx`,
  `app/(dashboard)/error.tsx` and `app/global-error.tsx`) still logs to the
  console, and now also calls `captureException` with a `boundary` tag. It
  skips errors that carry a `digest`: those came from the server, which
  `onRequestError` already reported with the real stack. The browser only
  has Next's sanitised copy, and every such copy would group into one issue.
- **One set of privacy options.** `lib/sentry-options.ts` holds the options
  every runtime shares: `tracesSampleRate: 0`, and `dataCollection` with
  user info, cookies, headers, bodies, URL query params and stack-frame
  variables all off. `beforeSend` removes the sender's IP address, because
  browser events come from users' own machines. The project's "Prevent
  Storing of IP Addresses" setting is also on; the code does not rely on it.
  Fetch and XHR breadcrumbs are off, since their URLs can carry search terms.
  Navigation breadcrumbs lose their query string (`withoutNavigationQuery`),
  because `/callback?code=...` carries the one-time OAuth code and
  `urlQueryParams: false` does not cover breadcrumbs.
- **Tunnel.** Events go to `/monitoring` on the app's own origin, and
  `withSentryConfig`'s `tunnelRoute` forwards them, so ad blockers that block
  sentry.io do not drop them. The rewrite only matches
  `/monitoring?o=<org>&p=<project>&r=<region>`, and only `@sentry/nextjs`'s
  own client init adds that query, so `tunnelFor` builds it from the DSN.
  `proxy.ts`'s matcher excludes exactly `/monitoring` (`monitoring(?:/|$)`):
  otherwise its sign-in redirect would swallow reports from signed-out pages,
  while a page like `/monitoring-dashboard` must still be guarded.
- **Source maps.** `withSentryConfig` uploads them and then deletes them from
  the output, so they are never served. The upload runs only when
  `SENTRY_AUTH_TOKEN` is set, which is on Vercel only. A build without it
  still succeeds, with minified stack traces. The release is Vercel's commit
  SHA. `withSentryConfig` inlines it as `process.env._sentryRelease`, which
  only `@sentry/nextjs`'s own init reads, so `instrumentation-client.ts`
  passes it to `@sentry/browser` by hand.

## Consequences

- A frontend crash appears in Sentry, grouped, tied to its release and
  tagged with the boundary that caught it.
- **Bundle cost, measured 2026-09-25** as the gzipped JavaScript each page
  loads on first visit (`next build` then `next start`, scripts referenced
  by the HTML):

  | Route                 | Without Sentry | With Sentry | Added   |
  | --------------------- | -------------- | ----------- | ------- |
  | `/login` (signed out) | 334.4 KB       | 369.9 KB    | 35.5 KB |
  | `/` (signed-in shell) | 257.5 KB       | 293.4 KB    | 35.9 KB |

  The SDK appears in one chunk per page, not duplicated between
  `instrumentation-client` and the error boundaries.

- Setting Sentry's build flags (`__SENTRY_DEBUG__`, `__SENTRY_TRACING__`)
  through `compiler.define`, and `withSentryConfig`'s
  `bundleSizeOptimizations`, changed nothing under Turbopack, so neither is
  used. The `production` export of `@sentry/browser` is already built
  without debug code.
- Vercel needs `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` (scope
  `project:releases`). The token is a secret and lives only in Vercel.

## Alternatives rejected

- **`@sentry/nextjs` in the browser too.** It is one package for all three
  runtimes, but it adds tracing code that is never used to every page.
- **No tunnel.** Simpler, but ad blockers commonly block sentry.io, which
  would hide exactly the errors real users hit.
