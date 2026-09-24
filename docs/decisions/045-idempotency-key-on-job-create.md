# ADR-045: `POST /jobs` accepts an `Idempotency-Key`, backed by Redis

## Status

Accepted

## Date

2026-09-24

## Context

A client cannot tell "the request never reached the server" from "the server
committed the job and the response was lost". Both look like a timeout or a
network error, and the natural reaction to either is to send the request
again. For `POST /jobs` that retry creates a second, identical job. Three
paths send it:

- `JobForm`: a user clicks **Add job** again after a slow or failed save.
  The company-history confirm adds a second path to the same `mutate`.
- The browser extension's `createJob` message.
- Any future client or proxy that retries writes automatically.

A database unique constraint cannot stop this. Two applications to the same
company and position are legitimate (a re-application, a second posting),
so there is no natural key to make unique. The request itself has to say
"this is the same attempt".

## Decision

`POST /jobs` accepts an optional `Idempotency-Key` header. The shape follows
the IETF `Idempotency-Key` draft and Stripe's API:

- **First request with a key** claims it with Redis `SET NX PX 60000` and
  stores a SHA-256 fingerprint of the body. It then runs normally. On success,
  the response body replaces the claim for 24 hours.
- **Same key, same body, completed:** the stored body is returned with
  `Idempotent-Replayed: true`, and no second row is created.
- **Same key, first request still running:** 409. `SET NX` is atomic, so two
  concurrent retries cannot both run.
- **Same key, different body:** 422. That is a client bug, not a retry.
- **Handler throws** (including a `ValidationPipe` 400, which runs inside the
  interceptor): the key is deleted, so a corrected retry is not blocked.
- **No header:** unchanged behaviour. The extension keeps working as is.

The Redis key is `idem:{userId}:{method}:{path}:{key}`. Scoping by user
means one user's key can never replay another user's response. The key is
capped at 255 characters, so the header cannot be used to fill Redis.

It is implemented as `IdempotencyInterceptor`
(`backend/src/common/interceptors/`), applied per route with
`@UseInterceptors`. Any other create endpoint can opt in with one decorator.
Redis access goes through a new global `RedisModule`, shaped like
`PrismaModule`. `AuthService` kept its own client when this ADR was written;
it has since moved onto `RedisService` too (see ADR-046, "Not covered").

**`JobForm` ties the key to the payload, not to the form session.** An
unchanged resubmit reuses the key; an edited one mints a new key. A key per
form session would turn "fix a typo after a failed save" into a 422. A key per
`mutate` call would turn every retry into a new request.

## Trade-offs

- **The idempotency layer fails open on a Redis outage.** If the claim
  cannot reach Redis, the request runs without the guarantee and a warning
  is logged. A payments API would fail closed; a job tracker should not
  refuse a save because its dedup store is down.

  With ADR-046 the rest of the create path fails fast too, so during an
  outage a keyed `POST /jobs` returns `201` promptly: the job is saved,
  the replay just isn't recorded. Before ADR-046, the response hung on the
  BullMQ enqueues, and the client's timeout-and-retry created exactly the
  duplicate this ADR exists to prevent. `RedisService` uses the same
  fail-fast settings as the queue connection (`enableOfflineQueue: false`,
  a 2s `commandTimeout`).
- **A crashed request holds its key for up to 60 seconds.** If the process
  dies between the claim and the store, retries get 409 until the pending TTL
  expires. A create finishes in well under a second, so 60 seconds only
  matters after a crash.
- **The replay is the body, not the full response.** The status is always
  the route's 201, so it is not stored. Headers other than
  `Idempotent-Replayed` are not replayed; `POST /jobs` sets none.
- **The fingerprint hashes the raw JSON body**, not a canonical form. A
  client that reorders keys between retries gets a 422. Both callers
  serialize the same object the same way, so this has not come up.

## Verification

- `idempotency.interceptor.spec.ts` covers each branch: no key, empty or
  oversized key, claim then store, replay, pending 409, 422 on mismatch,
  release on error, Redis down at claim, store and release.
- `test/app.e2e-spec.ts` posts twice with one key against real Postgres and
  Redis. It asserts one row, an identical body and the replay header. It
  then asserts 422 for a changed body, and that a validation 400 releases the
  key.
