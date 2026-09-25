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
- **Empty means off, and never blocks boot.** `docker-compose.prod.yml`
  passes `${SENTRY_DSN:-}` and `${SENTRY_ENVIRONMENT:-}`, which arrive as
  empty strings, and an image built without the `GIT_SHA` build arg has
  `SENTRY_RELEASE=""`. The env schema allows `''` on all three.
  `instrument.ts` treats an empty DSN as off and an empty release as none.
  Review caught that the first version rejected `''`, which would have
  stopped production from booting after the merge.
- **Errors only.** `tracesSampleRate: 0` and no profiling, so no native
  dependency. Tracing is a later OpenTelemetry step. `SentryModule` is not
  registered: it only adds the tracing interceptor.
- **Only deliberate captures.** The SDK's default `Nest` integration is
  removed. With tracing off, all it does is auto-capture from every
  `@Processor`, `@Cron`, `@Interval` and `@OnEvent` handler. That would
  report retried job attempts and each deliberate `DelayedError`, report
  final failures twice, and send cron errors with no `requestId`.
- **No Express spans.** The SDK's `Express` integration is removed as well
  (added after release). It opens a tracing span per Express layer, and each
  span adds a `finish` listener to the response. With tracing off the spans
  are never sent, and once ADR-052's metrics middleware added a layer, the
  listeners passed Node's limit of 10 and production logged a
  `MaxListenersExceededWarning`.
- **Unhandled rejections are `strict`.** The SDK's default `warn` mode
  installs a listener that stops Node from exiting on an unhandled
  rejection, so a failed boot would leave a process that serves nothing
  instead of letting Docker restart it. `strict` reports, then exits.
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
    be retried is not reported. Neither are BullMQ's control-flow errors
    (`DelayedError`, as in ADR-048, plus `WaitingChildrenError`,
    `WaitingError` and `RateLimitError`). Errors are matched by `name`, as
    BullMQ itself does, so a second copy of the package can't slip past an
    `instanceof`. The event is tagged with its queue and job name.
  - `runCronScan(name, work)` (`src/common/cron-scan.helper.ts`), which wraps
    all five `@Cron` methods. It runs the pass under `cron:<name>:<time>`
    (ADR-049), reports a failure with that `requestId` and a `cron` tag, then
    rethrows so `@nestjs/schedule` still logs it.
  - If `GlobalExceptionFilter` itself fails, it reports the original error
    only when it failed **before** deciding the status. A failure while
    sending an already-judged response (for example headers already sent)
    neither double-reports a 500 nor reports a 4xx.

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
