import * as Sentry from '@sentry/nestjs';

/**
 * Sentry error tracking (ADR-050). `main.ts` imports this before anything
 * else, because Sentry has to patch modules before they load.
 *
 * It only starts when `SENTRY_DSN` is set, so local runs, the test suites and
 * CI send nothing and carry no instrumentation. It reads `process.env`
 * directly: this runs before `ConfigModule` exists. Production passes the
 * variable through `docker-compose.prod.yml`, and the image bakes in the
 * commit SHA as `SENTRY_RELEASE`.
 *
 * Errors reach Sentry only through `reportError` (ADR-050). The SDK's `Nest`
 * integration is removed: with tracing off, all it adds is automatic capture
 * from every `@Processor`, `@Cron` and `@OnEvent` handler. That would report
 * retried job attempts and deliberate `DelayedError` deferrals, report final
 * failures twice, and send cron errors with no `requestId`.
 * `CorrelatedWorkerHost` and `runCronScan` report those deliberately instead.
 *
 * The `Express` integration is removed too. All it does is open a tracing
 * span per Express layer, and each span adds a `finish` listener to the
 * response. With tracing off the spans are never sent, and with this app's
 * dozen middleware layers the listeners passed Node's limit of 10, which
 * logged a `MaxListenersExceededWarning` in production.
 *
 * Unhandled rejections use `strict` mode: report, then exit, like Node's own
 * default. The SDK's default `warn` mode would keep a process whose boot
 * failed alive, serving nothing, instead of letting Docker restart it.
 *
 * Errors only for now: tracing comes later with OpenTelemetry. The SDK's v11
 * defaults would also send cookies, HTTP headers and request bodies, which
 * here means the refresh-token cookie, Authorization headers and login
 * passwords. All of that is turned off, along with stack-frame variables,
 * which can hold the same secrets. Events carry a user's ID only, set where
 * an error is reported (`reportError`).
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // `||`, not `??`: an image built without GIT_SHA has an empty release.
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0,
    integrations: (defaults) => [
      ...defaults.filter(
        (integration) =>
          integration.name !== 'Nest' &&
          integration.name !== 'Express' &&
          integration.name !== 'OnUnhandledRejection',
      ),
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  });
}
