import * as Sentry from '@sentry/nestjs';
import { scrubLogAttributes } from './infrastructure/error-tracking/log-attributes.helper.js';

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
 * Unhandled rejections use `strict` mode: report, then exit, like Node's own
 * default. The SDK's default `warn` mode would keep a process whose boot
 * failed alive, serving nothing, instead of letting Docker restart it.
 *
 * Errors only for now: tracing comes later with OpenTelemetry. That means
 * leaving `tracesSampleRate` unset, not setting it to 0: the SDK treats any
 * value, 0 included, as tracing on. At 0 it still installed the Prisma, Redis
 * and LLM span integrations and opened an unsent span per Express layer, each
 * adding a `finish` listener to the response. Past ten layers that logged a
 * `MaxListenersExceededWarning` in production. Unset, no spans are made. The
 * `Express` integration stays: it still reports a 5xx thrown by plain Express
 * middleware, which never reaches `GlobalExceptionFilter`.
 *
 * Warn, error and fatal log lines also go to Sentry Logs (ADR-053), so the
 * lines around an error are next to it. The pino integration only forwards
 * them as logs: its option to turn log lines into error events stays off,
 * because errors are already reported deliberately. `beforeSendLog` cuts
 * every line down to an allowlist of fields (`scrubLogAttributes`), since a
 * log line can carry anything, including an email address or a cookie.
 *
 * The SDK's v11
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
    integrations: (defaults) => [
      ...defaults.filter(
        (integration) =>
          integration.name !== 'Nest' &&
          integration.name !== 'OnUnhandledRejection',
      ),
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
      Sentry.pinoIntegration({ log: { levels: ['warn', 'error', 'fatal'] } }),
    ],
    beforeSendLog: (log) => ({
      ...log,
      attributes: scrubLogAttributes(log.attributes ?? {}),
    }),
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
