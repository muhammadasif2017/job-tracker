# ADR-046: BullMQ queue adds fail fast when Redis is down; workers wait it out

## Status

Accepted

## Date

2026-09-24

## Context

`POST /jobs` hung for as long as Redis was down. A manual test stopped the
Redis container and posted a job. The row committed, then the response
never came back: curl gave up at 30s and at 60s. It hung with or without
an `Idempotency-Key`.

The create path awaits two BullMQ adds: company enrichment through
`enqueueIfStale`, and the timeline summary. Both callers already treat a
failed add as best-effort. They catch it, log `… enqueue failed`, and let
the create stand. `enqueueIfStale` also rolls its `PENDING` claim back to
`null`, so the company is not stranded. The problem was that the add never
failed.

All queues and workers shared one connection from `BullModule.forRoot`,
with `maxRetriesPerRequest: null`. BullMQ requires that for workers, whose
blocking commands must survive a reconnect. On a `Queue`, it means ioredis
parks every command in its offline queue and retries it forever. So during
an outage `queue.add` stayed pending until Redis came back, and so did the
HTTP request awaiting it.

The effect on a client: a timeout for a job that was saved. A retry then
creates a duplicate. The idempotency layer (ADR-045) cannot catch that
duplicate, because it is down too.

## Decision

Producers and consumers get different connections. They are built in
`backend/src/redis/redis-connection.helper.ts`:

- **`queueConnection()`**, used by `BullModule.forRoot` and so by every
  injected `Queue`, has `enableOfflineQueue: false`,
  `maxRetriesPerRequest: 1` and `commandTimeout: 2000`. A command while Redis
  is disconnected rejects at once. A command to a Redis that has stopped
  answering, without closing the socket, rejects after 2s.
- **`workerConnection()`** keeps the previous options, including
  `maxRetriesPerRequest: null`. Each `@Processor` passes it through
  `withWorkerConnection(...)`, which overrides the forRoot connection: the
  worker options are spread last in `@nestjs/bullmq`'s `BullExplorer`. So
  workers still wait out an outage and resume on their own.

`withWorkerConnection` resolves the connection in a getter, read when the
`Worker` is built. `@Processor(...)` arguments are evaluated at import,
before `ConfigModule` has loaded `.env`. An eager call there would read an
unset `REDIS_URL` locally and connect to localhost without saying so. Prod
is not affected, because compose sets `REDIS_URL` in the process
environment. `commandTimeout` must never reach a worker: a blocking
`BZPOPMIN` outlives it.

**The one producer that was not best-effort.** `scanInterviewReminders`
stamps `reminderSentAt` before it adds the reminder, so that a crash skips a
reminder rather than sending it twice. Before this change, an outage made
that add hang, and the reminder went out late once Redis came back. After
it, the add fails. Left alone, that would stamp the round and silently skip
the reminder. The scan now un-stamps the round, with a compare-and-swap on
its own stamp, then logs and stops. The next hourly scan retries it.

That applies only when ioredis *refused* the command. A `commandTimeout`
rejection (`Command timed out`) means the reply was late, not that the add
failed. Redis may have queued the job anyway, so the stamp stays, and the
scan still prefers skipping a reminder to sending it twice. A stable BullMQ
`jobId` per round would have made the retry a no-op instead. It was
rejected because a reschedule clears `reminderSentAt` so that a second
reminder goes out, and a kept completed job under that id would swallow
it.

The digest cron needs no change. A failed add throws out of the cron,
`@nestjs/schedule` logs it, and that hour's digests are skipped. Before
this change they were delivered late instead.

## Verification

Manual outage test against the built app on 2026-09-24: `docker stop` on
Redis, then `POST /jobs`.

| | Before | After |
|---|---|---|
| `POST /jobs` | hung until client timeout (30s, 60s) | `201` in 0.15s |
| Job row | committed | committed |
| Company `status` | not observed | rolled back to `NULL` |
| `GET /health` | not measured | `503` in 6ms |
| Log | — | `Enrichment enqueue failed`, `Timeline summary enqueue failed` |

After `docker start` on Redis, a new job at the same company was
enriched to `COMPLETED` in about 9s. The worker connection had
reconnected by itself. The boot log had no BullMQ
`maxRetriesPerRequest must be null` warning, which confirms the override
reached all three workers.

`redis-connection.helper.spec.ts` covers both shapes, parsing `REDIS_URL`
including an encoded password, and the lazy getter. The two processor
specs now assert the worker connection shape. The scheduler spec covers the
un-stamp.

## Not covered

**Redis already down when the backend boots.** Fail-fast only applies once
BullMQ's first connection has succeeded. Until then, every `Queue` awaits
its connection's `ready`, and a create awaiting an add hangs just as it
did before this change. Measured on 2026-09-24 with Redis stopped before
boot: `/health` and `POST /jobs` both hung until the client timed out.
Once Redis started, without a backend restart, the pending create
finished, and both companies enriched to `COMPLETED`. So the hang clears
by itself when Redis returns, and nothing regressed. In prod, the backend
`depends_on: redis: condition: service_healthy`, which covers a normal
start.

BullMQ's `skipWaitingForReady: true` looks like the fix, and its docs
suggest it for adding jobs from HTTP handlers. It was tried and rejected.
With Redis down at boot, the queue's one-time connection init fails and is
never retried. After Redis came back, `/health` stayed `503` and every add
kept failing until the process restarted. That trades a hang that heals
itself for an outage that doesn't.

**OAuth code exchange.** Resolved later on 2026-09-24. `AuthService` now
uses the shared `RedisService` (fail-fast, see ADR-045) instead of its own
client, and turns a Redis failure into a `503`. Measured with Redis stopped:
`POST /auth/exchange-code` answered `503` in 0.01s. It used to hang.
