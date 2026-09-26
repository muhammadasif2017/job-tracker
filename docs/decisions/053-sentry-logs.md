# ADR-053: Warn and error log lines in Sentry Logs

## Status

Accepted

## Date

2026-09-25

## Context

Sentry (ADR-050) shows an error and its `requestId`, but the log lines around
it stayed on the VM: reading them meant SSH and `docker compose logs | grep`.
Warnings that are not errors, such as a queue whose counts could not be read
or an email that failed to send, never reached Sentry at all.

## Decision

Send the backend's `warn`, `error` and `fatal` pino lines to Sentry Logs,
through the SDK's `pinoIntegration` in `src/instrument.ts`. The integration
hooks pino's own diagnostics channel, so pino itself needs no setup. The
calls do change, though: fields only arrive when logged object-first through
Nest's `Logger`, which is why every service moved to it (below).

- **Logs only, not events.** The integration can also turn log lines into
  error events. That stays off: errors are reported deliberately
  (`reportError`, ADR-050), and a second path would report them twice.
- **Info and below stay on the VM.** Every request writes an info line;
  sending those would use the free quota for little gain.
- **An allowlist of fields.** `beforeSendLog` passes every line through
  `scrubLogAttributes` (`infrastructure/error-tracking/log-attributes.helper.ts`).
  - It keeps `requestId`, `context`, `jobId`, `companyId`, `roundId`,
    `userId`, `queue`, `model`, `phase`, `errorName`, `status` and
    `responseTime`, and
    only when the value is a string, number or boolean. An object under an
    allowed key could carry anything (see the logging style below).
  - From `req` it keeps only the method and the path without its query
    string, which is where search terms live. From `res` it keeps the status
    code, and from `err` only its type.
  - Everything else is dropped: headers (including the refresh cookie),
    bodies, the error's message and stack (Sentry Issues carries those for
    reported errors), `sentry.message.parameter.*`, and any other field, such
    as the `to` address the email service logs. Sentry adds a few
    attributes of its own after `beforeSendLog` (the timestamp sequence,
    scope attributes), so those bypass it.
  - A denylist would leak the next field nobody thought of. With the
    allowlist, a new field stays on the VM until it is added on purpose.
- **One logger, object-first, with a fixed message.** nestjs-pino's
  injected `Logger` files the _last_ extra argument as the context. So the
  old `logger.warn('msg', { jobId, err })` put the whole object under
  `context` (where an allowlist that passed objects would have sent an email
  address through) and never produced a top-level `jobId` or `err`. An
  object-first call on it, `warn({ jobId }, 'msg')`, loses its message
  instead, which becomes the context. So every service now uses Nest's
  `new Logger(ClassName.name)`, which adds the context itself, and every call
  is `logger.warn({ jobId, err }, 'fixed_message')`. Error text goes in
  `err`, which stays on the VM, never into the message.
- **Messages that are error text are withheld.** Pino uses `err.message` as
  the message of a line logged with an error and no message, which is how
  Nest's scheduler and exception handler log. A pino `hooks.logMethod`
  (`fixedMessageForBareErrors`, set in `AppModule`) gives such a line a fixed
  message where it is written. As a fallback, `scrubLog` replaces a message
  that _is_ the error's text (equal to it, or to the part before the causes
  that the serializer appends) with the error's type.
- **Never interpolate error text into a message.** A message that merely
  contains error text, such as `` `Sync failed: ${err.message}` ``, is not
  withheld: telling it apart from a fixed message that happens to contain a
  short error string ('Request timeout' and 'timeout') would drop useful
  messages. Put the error in `err`.
- **Off without a DSN,** like the rest of `instrument.ts`.

## Consequences

- An error's surrounding warn and error lines are searchable in Sentry
  (**Explore → Logs**) by `requestId`, next to the issue.
- Checked locally against a stand-in Sentry endpoint: the Redis connection
  errors arrived as `log` items carrying only `context` and Sentry's own
  attributes. The real output of both loggers, for each call style, was
  checked the same way.
- **Outage volume.** `RedisService` logs a Redis outage at error level once,
  when the connection drops, then each reconnect attempt (about one every
  2 s) at debug, which stays on the VM, and "restored" when it is back.
  Before, every attempt was an error line, about 1,800 an hour. An error on
  a connection that is still up is logged at error and does not start an
  outage, so it cannot hide the next one, while a socket error that means
  the connection dropped (`ECONNRESET` and the like, which ioredis emits
  before its status changes) does start one.
- **One rule for lines an outage causes.** `RedisService` shares its outage
  state, and `logRedisFailure` (`redis-errors.helper.ts`) logs at debug while
  an outage is reported and warns otherwise. Every place a Redis failure is
  logged per request, per scrape or per scan uses it: idempotency, the
  exception filter's 503, the OAuth code store, queue metrics and the
  best-effort queue enqueues. A failure `RedisService` never sees, such as a
  command timing out on a live connection or a wrong password, is therefore
  still a warning.
- **CPU.** The integration JSON-parses every pino line, info included,
  before filtering by level. For a line of about 1 KB that is microseconds
  per request, which this traffic does not notice.
- **Not covered by the allowlist:** attributes set on a Sentry scope are
  merged after `beforeSendLog`. Nothing here sets them; do not start without
  revisiting this ADR.
- The logger change touched about 20 services, whose specs now spy on
  `Logger.prototype` instead of injecting a mock logger.
- Log lines need the same care as error events: never log an email address,
  token or request body under an allowlisted key.

## Alternatives rejected

- **Grafana Loki through Alloy.** It would carry all containers' logs, but
  needs another token and a scrubbing pipeline in Alloy's config language.
  Sentry puts the lines next to the error they explain, which is the main
  use today.
- **Scrub with a denylist.** Simpler, but it fails open.
