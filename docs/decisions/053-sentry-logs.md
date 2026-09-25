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
hooks pino's own diagnostics channel, so no logger code changes.

- **Logs only, not events.** The integration can also turn log lines into
  error events. That stays off: errors are reported deliberately
  (`reportError`, ADR-050), and a second path would report them twice.
- **Info and below stay on the VM.** Every request writes an info line;
  sending those would use the free quota for little gain.
- **An allowlist of fields.** `beforeSendLog` passes every line through
  `scrubLogAttributes` (`infrastructure/error-tracking/log-attributes.helper.ts`).
  - It keeps `requestId`, `context`, `jobId`, `companyId`, `roundId`,
    `queue`, `model`, `status` and `responseTime`.
  - From `req` it keeps only the method and the path without its query
    string, which is where search terms live. From `res` it keeps the status
    code, and from `err` its type, message and stack.
  - Everything else is dropped: headers (including the refresh cookie),
    bodies, and any field someone logs, such as the `to` address the email
    service logs.
  - A denylist would leak the next field nobody thought of. With the
    allowlist, a new field stays on the VM until it is added on purpose.
- **Off without a DSN,** like the rest of `instrument.ts`.

## Consequences

- An error's surrounding warn and error lines are searchable in Sentry
  (**Explore → Logs**) by `requestId`, next to the issue.
- Checked locally against a stand-in Sentry endpoint. The Redis connection
  errors arrived as `log` items carrying only `context` and Sentry's own
  attributes.
- **Outage volume.** During a Redis outage, `RedisService` logs a connection
  error on every reconnect attempt, about one every 2 s. An hour-long outage
  sends about 1,800 lines. If that strains the quota, rate-limit that log
  line rather than dropping the level.
- Log lines need the same care as error events: never log an email address,
  token or request body under an allowlisted key.

## Alternatives rejected

- **Grafana Loki through Alloy.** It would carry all containers' logs, but
  needs another token and a scrubbing pipeline in Alloy's config language.
  Sentry puts the lines next to the error they explain, which is the main
  use today.
- **Scrub with a denylist.** Simpler, but it fails open.
