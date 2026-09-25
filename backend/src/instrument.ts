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
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
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
