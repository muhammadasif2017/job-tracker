# ADR-050: Sentry error tracking for the backend

## Status

Accepted

## Date

2026-09-25

## Context

An unexpected 500, or a background job that failed for good, existed only as
a log line on the VM. Nobody was told, and finding it meant knowing to look.
ADR-049 gave every request and job a correlation ID, but nothing yet grouped
errors, counted them or showed which release introduced one.

## Decision

Report unexpected errors to Sentry (`@sentry/nestjs` v11, project
`job-tracker-backend`).

- **`src/instrument.ts`**, imported first in `main.ts`, calls
  `Sentry.init` only when `SENTRY_DSN` is set, so local runs, the test suites
  and CI send nothing and carry no instrumentation.
  - It reads `process.env` directly, because it runs before `ConfigModule`.
  - `environment` comes from `SENTRY_ENVIRONMENT`, falling back to `NODE_ENV`.
  - `release` is the commit SHA: `deploy.yml` passes it as the `GIT_SHA`
    build arg, and the image bakes it in as `SENTRY_RELEASE`.
- **Errors only.** `tracesSampleRate: 0` and no profiling, so no native
  dependency. Tracing is a later OpenTelemetry step. `SentryModule` is not
  registered: it only adds the tracing interceptor.
- **Data collection is locked down.** SDK v11's defaults collect cookies,
  HTTP headers and request bodies, which here means the refresh-token cookie,
  `Authorization` headers and login passwords. `dataCollection` turns off
  those, plus user info, URL query params, database query data and
  stack-frame variables (which can hold the same secrets). An event carries
  a user's **ID** only, set where it is reported.
- **What gets reported**, through `reportError`
  (`infrastructure/error-tracking/error-tracking.helper.ts`), always tagged
  with `requestId`:
  - `GlobalExceptionFilter`: any response ≥ 500 **except 503**. Every 503
    here is a deliberate "temporarily unavailable" answer to an outage
    (Redis, the OAuth code store), which is already logged and isn't a bug.
    4xx responses, including the Prisma-mapped 409 and 404, are client
    errors and aren't reported. If the filter itself fails, it still
    reports the original error.
  - `CorrelatedWorkerHost`: a job failure only when it is **final**, meaning
    an `UnrecoverableError` or the last allowed attempt. A failure that will
    be retried, and a deliberate `DelayedError` deferral (ADR-048), are not
    reported. The event is tagged with its queue and job name.

## Consequences

- An unexpected error appears in Sentry grouped, counted and tied to the
  commit that shipped it, and its `requestId` tag leads straight to the log
  lines for that request or job.
- Measured on 2026-09-25: a wiring-check event sent from the built code with
  the real DSN arrived as `JOB-TRACKER-BACKEND-1`. It carried the tags
  `requestId`, `release` and `environment`, a user ID only, and no headers,
  cookies or body. It was then resolved.
- **Dependency cost.** `@sentry/node` v11 lists `@sentry/bundler-plugins`
  (webpack, babel, glob) as a runtime dependency, which adds about 50 MB of
  `node_modules` to the image. That subtree also brought three advisories
  (`brace-expansion`, `browserslist`, `baseline-browser-mapping`). They are
  fixed by overrides scoped to `@sentry/bundler-plugins` in `package.json`,
  and the production `npm audit` count is back to exactly `main`'s.
- Sentry derives `user.geo` from the IP address that **sends** the event.
  That is the VM, not the user. The project setting "Prevent Storing of IP
  Addresses" turns it off if wanted.

## Alternatives rejected

- **`@SentryExceptionCaptured()` on the filter.** It skips any
  `HttpException`, but it would report the Prisma-mapped and Redis-mapped
  errors this filter turns into 409, 404 and 503. An explicit rule on the
  final status code is clearer and testable.
- **Reporting every job attempt.** That creates one event per retry for a
  transient blip. Only the final failure is actionable.
