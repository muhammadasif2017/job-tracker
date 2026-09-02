# Backend CLAUDE.md

## Commands

```bash
npm run start:dev                              # watch mode on :3001
npm run build                                 # compile to dist/
npm run test:e2e                              # e2e suite (requires local PostgreSQL on :5432)
npx tsc --noEmit                             # type check only
npx prisma migrate dev --name <name>          # create + apply migration
npx prisma generate                           # regenerate client after schema change
npx prisma studio                             # GUI DB browser
```

**After every `prisma migrate dev`, run `prisma generate`** — the TypeScript client (including new enums) is not updated by migrate alone.

**`tsBuildInfoFile` must live inside `dist/`** (set in `tsconfig.json`). `nest start --watch` deletes `dist/` on startup (`deleteOutDir: true`), but a tsbuildinfo stored outside `dist/` survives and tells tsc the build is current — tsc emits nothing and the server crashes with `Cannot find module dist\main`. Keeping the tsbuildinfo inside `dist/` makes both get wiped together. If you ever see that crash, delete any stray `*.tsbuildinfo` at the backend root.

---

## Prisma 7 Quirks

- **No `url` field in `datasource db {}`** — connection is wired at runtime:
  ```ts
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  super({ adapter });
  ```
- `prisma.config.ts` at the backend root is Prisma 7's required config file — do not delete it.
- Always run `prisma generate` after any schema change or migration.
- **Two indexes are raw SQL and are NOT represented in `schema.prisma`** — a functional UNIQUE index on `companies (userId, lower(name))` and four `pg_trgm` GIN indexes on `Job`'s searchable columns (migration `20260903090000_company_ci_unique_and_job_search_trgm`). Prisma has no syntax for expression or operator-class indexes, so **the next `prisma migrate dev` will generate `DROP INDEX` statements for all five — delete those lines from the generated migration before applying it.** Both models carry a comment saying so. `JobsService.resolveCompanyId` depends on the unique index for correctness (its `P2002` fallback), and `buildJobWhere`'s `ILIKE '%term%'` search is a sequential scan without the trigram indexes.
- **A Serializable-transaction write conflict Postgres only detects at COMMIT time does NOT surface as `PrismaClientKnownRequestError({code: 'P2034'})`** under `@prisma/adapter-pg` + the client-engine-runtime — it propagates a raw, unwrapped `DriverAdapterError` (`name: 'DriverAdapterError'`, `cause: { kind: 'TransactionWriteConflict' }`) straight out of `$transaction()`. A catch block checking only `err.code === 'P2034'` misses this and lets it fall through as an unhandled 500. Mid-transaction conflicts (a concurrent UPDATE/DELETE on a row already touched) *are* wrapped normally — this only bites conflicts on a broader predicate (e.g. a `COUNT(*)` read racing a concurrent INSERT into the counted set), which Postgres's SSI often can't detect until commit. Found via a real two-writer e2e test (`test/app.e2e-spec.ts`, "POST /companies — concurrent per-user cap") — no mock-based unit test can catch this, since mocks only ever simulate the P2034 shape directly. Use `isTransactionWriteConflict` (`src/common/prisma-errors.ts`) in any catch block mapping a Serializable-transaction conflict to a `ConflictException`, not a bare `err.code === 'P2034'` check.

---

## Auth Architecture

### Global Protection

`JwtAuthGuard` is applied globally in `main.ts`. Every route is protected by default. Use `@Public()` to opt out:

```ts
@Public()
@Post('login')
login(...) {}
```

### Token Strategy

Two JWTs issued together by the private `issueTokens(userId, email)` method:

- **Access token** — 15 min, signed with `JWT_SECRET`. Sent as `Authorization: Bearer`.
- **Refresh token** — 7 days, signed with `JWT_REFRESH_SECRET`, carries a `jti`. Never in the request/response body — set as an `httpOnly; SameSite=Lax` cookie (`jt_refresh`, scoped to `/auth`) by `AuthController`, read back by `JwtRefreshStrategy` off `req.cookies`. Stored server-side as a **bcrypt hash** in the separate `RefreshToken` table (keyed by `jti`, not a column on `User`).

On every refresh, the old `RefreshToken` row is soft-revoked (`revokedAt` set, not deleted) and a new pair (new `jti`, new row) is issued. Presenting an already-revoked token (replay of a rotated-out refresh token) is treated as a theft signal — it revokes every `RefreshToken` row for that user, not just the one presented.

`AuthService.cleanupExpiredRefreshTokens` (`@Cron(EVERY_DAY_AT_MIDNIGHT)`, via `@nestjs/schedule`'s `ScheduleModule.forRoot()` in `AppModule`) deletes rows past `expiresAt` — both naturally expired and soft-revoked rows accumulate until this runs. `TokensService.cleanupExpiredApiTokens` is the same pattern for `ApiToken` rows.

### `@CurrentUser()` Decorator

Extracts `req.user` — populated by `JwtStrategy.validate()` which returns `{ id, email, name, avatarUrl }`. Use this in every protected controller method:

```ts
@Get('profile')
getProfile(@CurrentUser() user: { id: string }) {
  return this.usersService.getProfile(user.id);
}
```

### OAuth Flow

```
GET /auth/google
  → Google OAuth → GET /auth/google/callback
  → GoogleStrategy.validate() → handleOAuthUser() → issueTokens()
  → storeOAuthCode(tokens) → short-lived UUID in Redis (60s TTL)
  → redirect to ${FRONTEND_URL}/callback?code=<uuid>
  → Frontend: POST /auth/exchange-code { code } → { accessToken } + jt_refresh httpOnly cookie
```

`handleOAuthUser` resolution order:

1. Find existing `Account` by `[provider, providerAccountId]` → return tokens
2. Find `User` by email → link new `Account` → return tokens
3. Create new `User` + `Account` → return tokens

---

### Personal Access Tokens (PATs) — Scoped, Not Full-Access

`ApiToken` (see `TokensModule`, `POST/GET/DELETE /tokens`) is a long-lived credential for clients that can't hold the httpOnly refresh cookie (the browser extension). `AuthService.exchangeApiToken` trades a raw PAT for a normal 15-minute access JWT — but that JWT carries an extra `scope: 'pat'` claim (`PAT_SCOPE` in `tokens.constants.ts`) that a login/OAuth/refresh-issued JWT never has.

`JwtStrategy.validate()` copies `payload.scope` onto `req.user` when present. `PatScopeGuard` (global, registered in `main.ts` right after `RolesGuard` — order matters, same as `RolesGuard` needing `req.user`) reads it: a token with no scope (normal login) passes through untouched; a token with `scope: 'pat'` is rejected on any route that isn't explicitly marked `@PatAccessible()`. This is opt-in, same shape as `@Public()`/`@Roles()` — a leaked PAT can only reach the handful of endpoints the extension actually needs (currently `POST /jobs` and `POST /jobs/parse`), not password change, account deletion, admin routes, or minting more tokens.

The access JWT itself is otherwise stateless — to make `DELETE /tokens/:id` take effect immediately instead of up to 15 minutes later, PAT-scoped tokens also carry a `patId` claim (the source `ApiToken.id`), and `JwtStrategy.validate()` re-checks that row's `revokedAt`/`expiresAt` on every request. This lookup only runs for `scope: 'pat'` tokens — normal login/refresh-derived tokens skip it.

`ApiToken.expiresAt` (`PAT_EXPIRY_DAYS` in `tokens.constants.ts`, currently 180 days from creation) bounds exposure from a token that's never manually revoked — checked both in `AuthService.exchangeApiToken` (can't exchange an expired PAT) and in `JwtStrategy.validate()` (an already-issued JWT stops working once its source PAT expires, same as revocation).

`test/app.e2e-spec.ts` manually mirrors `main.ts`'s guard list — `PatScopeGuard` must be added there too if the global guard set changes again.

**No explicit `algorithm`/`algorithms` pin on sign or verify** — tried once, reverted same branch. Both `JWT_SECRET` and `JWT_REFRESH_SECRET` are plain HMAC secret strings, and `jsonwebtoken` (under `@nestjs/jwt`/`passport-jwt`) already restricts `verify()` to the HMAC family (HS256/384/512) whenever `secretOrKey` is a string/Buffer rather than an asymmetric public key — the classic RS256→HS256 alg-confusion attack only applies when a public key is in play. Pinning `algorithm: 'HS256'` here was redundant defensive code, not a fix for a real gap. Re-pin only if either secret is ever swapped for an asymmetric keypair.

---

## Admin Architecture

`User.role` (`Role` enum: `USER` | `ADMIN`) gates `admin/users` routes via `RolesGuard`, a second global guard registered in `main.ts` right after `JwtAuthGuard` (order matters — it reads `req.user`). Mark a route with `@Roles(Role.ADMIN)`; unannotated routes are open to any authenticated user, same opt-in shape as `@Public()`.

`AdminService` does not scope by the requesting user's own ID (the point is acting on other users' rows) — the only identity checks are the guard plus an explicit self-delete block in `deleteUser`. Admin deletion reuses `UsersService.deleteById` (same routine as self-service delete); storage `storageKey`s are collected before the DB delete and cleaned up after, since they're outside Prisma's cascade.

No in-app flow promotes a user to `ADMIN` — direct DB/Prisma Studio only. Full rationale and rejected alternatives: [ADR-023](../docs/decisions/023-admin-rbac.md).

---

## Jobs: Authorization Pattern

Every service method that operates on a specific job calls `findOne(userId, jobId)` first. This throws `ForbiddenException` if the job belongs to a different user. Never skip this check:

```ts
async update(userId: string, jobId: string, dto: UpdateJobDto) {
  const existing = await this.findOne(userId, jobId); // ownership check
  // ...
}
```

## Jobs: Event Logging

Events are written inside the same Prisma operation as the job mutation wherever possible — never in a needlessly separate call:

```ts
// On create:
events: { create: { type: JobEventType.CREATED, toStatus: initialStatus } }
```

**Status-change events are the one documented exception.** Both `JobsService.update` (manual `PATCH /jobs/:id`) and `InterviewRoundsService.logRoundEvent` (auto-promotion) write the status transition as a conditional `updateMany` (compare-and-swap on the previously-read status) followed by a separate `jobEvent.create`, both inside one `prisma.$transaction`:

```ts
const { count } = await tx.job.updateMany({
  where: { id: jobId, status: existing.status }, // or JobStatus.APPLIED for auto-promotion
  data: { status: dto.status },
});
if (count === 0) throw new ConflictException(/* lost the race */);
await tx.jobEvent.create({ data: { jobId, type: JobEventType.STATUS_CHANGE, fromStatus: existing.status, toStatus: dto.status } });
```

`updateMany` can't carry a nested `events: { create: ... } }`, so this can't be one Prisma call — the CAS is what closes the TOCTOU race where a concurrent status change (e.g. an interview-round auto-promotion racing a manual edit) would otherwise let a stale `existing.status` get written into `fromStatus`. See [ADR-018](../docs/decisions/018-interview-round-status-sync-race-fixes.md) for the race this replaced and why single-statement writes weren't safe here.

---

## TypeScript Import Convention

All source imports use `.js` extensions even though files are `.ts`:

```ts
import { AuthService } from './auth.service.js';
```

This is intentional (ESM-style paths). `jest-e2e.json` has a `moduleNameMapper` that strips `.js` so ts-jest can resolve them. Do not change this convention.

For Express types (`Request`, `Response`) in decorated parameters, use `import type` to satisfy `isolatedModules`:

```ts
import type { Request, Response } from 'express';
```

---

## Adding a New Feature Module

See the `add-backend-module` skill for the step-by-step checklist.

## Jobs: nextInterviewAt Is Derived, Not User-Settable

`Job.nextInterviewAt` is **not** in `CreateJobDto`/`UpdateJobDto` — it's computed
by `InterviewRoundsService.recomputeNextInterviewAt(tx, jobId)` after every
create/update/delete of an `InterviewRound`, as the earliest future (`scheduledAt
>= now`) round still `PENDING`, or `null` if none. It takes a `Prisma.TransactionClient`
and always runs inside the same `$transaction` as the round mutation that
triggered it — not as a standalone call. Never add it back to the job
DTOs; the global `ValidationPipe` has `forbidNonWhitelisted: true`, so a client
sending it gets a 400. See ADR-015 for the full rationale (why a separate 1:many
model instead of embedding, why this field isn't user-writable), and
[ADR-018](../docs/decisions/018-interview-round-status-sync-race-fixes.md) for
a known, unfixed lost-update window under concurrent round mutations (low
impact — this field only drives a "needs attention" heuristic and
self-corrects on the next mutation).

`JobsService.findOne` includes `interviewRounds: { orderBy: { scheduledAt: 'asc'
} }` alongside `companyProfile`/`resume` — the frontend gets round data for free
from the existing `['job', id]` query; no separate fetch.

---

## Jobs: `appliedAt` Is Re-Stamped on Leaving WISHLIST

`Job.appliedAt` is `@default(now())`, so a wishlisted job carries the date it
was *saved*. `JobsService.update` re-stamps it to `now()` when a status change
moves the job out of `WISHLIST` in any direction (the board allows a drag
straight to INTERVIEWING) — unless the same request carries an explicit
`appliedAt`, which wins. Without this every "applications sent" metric
(`getStats.thisMonth`, the trend buckets, the 30d/90d range filters, the CSV
"Applied Date", the default list sort) dated the application from the save.
`SENT_APPLICATION_FILTER` excludes `WISHLIST` rows from those metrics; this is
the other half of that rule, covering what happens once a row leaves. See
ADR-033.

Anything calendar-shaped in `JobsStatsService` resolves in the user's own
`User.timezone` (the same column the digest/reminder schedulers read), via
`src/common/timezone.util.ts` — not the server's zone. Don't reach for
`new Date(y, m, d)` or local `getMonth()`/`getDate()` in a stats path.

---

## Jobs/Companies: `companyId` FK Resolution

`JobsService.resolveCompanyId(userId, trimmedName)` is the single find-or-create
path for turning a job's free-text `company` label into a real `Company` row
and its `Job.companyId` FK — case-insensitive exact match, `CompanyCity.OTHER`
for auto-created rows. Concurrency is enforced by the database, not the
application: a **raw functional unique index on `(userId, lower(name))`**
(migration `20260903090000_company_ci_unique_and_job_search_trgm`) makes a
case-variant race ("Google" vs "google") an ordinary unique violation, so the
method is a plain `findFirst` + `create` with a single re-fetch on `P2002`. It
used to run in a `Serializable` transaction with an 8-attempt jittered retry
loop; that's gone — the case-insensitive `findFirst` had no index to match, so
Serializable predicate-locked the user's whole `(userId, name)` range and two
creates for unrelated company names aborted each other, which taxed exactly the
bulk paths (extension, CSV import) that fire many creates for one user. Don't
reintroduce a transaction here. See ADR-033. Both
`create` and `update` reject an explicit `company: null` with a 400 —
`Job.company` is a required non-nullable column, so there's no "unlink" state
for a client to clear it into (unlike the optional profile fields this repo's
`T | null` convention normally applies to). `update` only re-resolves when the
submitted label actually differs (case-insensitively) from the job's current
stored label — not merely because `dto.company` is present in the payload,
since `JobForm` resends the current label on every submit whether or not the
user touched it. This guard is what keeps `Job.company` (the label as typed
at link time) from being retroactively rewritten just because the linked
`Company` was renamed or merged elsewhere; see ADR-030 for the bug this
replaced (the "only when sent" check alone wasn't sufficient). Don't
reintroduce a separate inline find-or-create in either method — that's
exactly the drift ADR-029 and ADR-030 fix. The CSV backfill
script (`backend/scripts/backfill-company-fk.core.ts`) duplicates this same
logic rather than importing it, since it runs standalone against a raw
`PrismaClient` outside Nest's DI container.

`JobResponseDto.companyProfile` is only populated by `findOne`'s reshaped
response — `PATCH /jobs/:id` returns the raw Prisma update result, which
doesn't include it. Don't add a new PATCH consumer that reads this field
without checking `findOne` first; existing ones (e.g.
`usePatchJobStatusMutation`) re-graft the previous `companyProfile` instead
of trusting the PATCH response. See [ADR-029](../docs/decisions/029-company-fk-integrity-and-enrichment-card-unification.md).

---

## Storage: Dual-Driver Pattern

`StorageModule` is global. It exposes a single `STORAGE_SERVICE` injection token backed by either `LocalStorageService` (dev) or `OracleStorageService` (prod), selected at startup by `STORAGE_DRIVER`:

```ts
@Inject(STORAGE_SERVICE) private storage: IStorageService
```

**`STORAGE_DRIVER=local` (default)** — writes files to `backend/uploads/` on disk. The controller serves them via `GET /jobs/resumes/file?key=<path>` (path-traversal-safe, auth-gated). This endpoint throws 404 when `STORAGE_DRIVER=oracle` — don't call it in prod.

**`STORAGE_DRIVER=oracle`** — uploads to Oracle Cloud Object Storage via S3-compatible API. Clients receive short-lived presigned URLs (`GET /jobs/:jobId/resumes/url`) and fetch the file directly from OCI. The backend never proxies binary file content in this mode.

---

## Resumes: Upload Consistency

`ResumesService.upload` writes to storage **before** the DB upsert. If the DB fails, the `catch` block deletes the newly uploaded file. This ordering is intentional:

- Storage-first: a dangling storage file is better than a DB record pointing at nothing
- The old storage key (when replacing an existing resume) is deleted **after** the DB upsert succeeds, so the old file remains accessible until the new record is committed

When a job is deleted, `JobsService.remove` looks up the resume's `storageKey` before calling `deleteMany`, then fires a fire-and-forget storage delete. The `Resume` row itself is cleaned up by cascade.

---

## Environment Variables

| Variable                 | Required | Default                  | Notes                                                                                                                                                 |
| ------------------------ | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Yes      | —                        | PostgreSQL connection string                                                                                                                          |
| `PORT`                   | No       | `3001`                   |                                                                                                                                                       |
| `JWT_SECRET`             | Yes      | —                        | Min 32 chars                                                                                                                                          |
| `JWT_REFRESH_SECRET`     | Yes      | —                        | Min 32 chars                                                                                                                                          |
| `JWT_EXPIRES_IN`         | No       | `15m`                    |                                                                                                                                                       |
| `JWT_REFRESH_EXPIRES_IN` | No       | `7d`                     |                                                                                                                                                       |
| `FRONTEND_URL`           | No       | `http://localhost:3000`  | Used for CORS and OAuth redirect                                                                                                                      |
| `BACKEND_URL`            | No       | `http://localhost:3001`  | Backend origin used to build OAuth callback URLs sent to Google/GitHub; also used by `LocalStorageService` to build the file-serve URL                |
| `GOOGLE_CLIENT_ID`       | No       | `'placeholder'`          | App starts without it                                                                                                                                 |
| `GOOGLE_CLIENT_SECRET`   | No       | `'placeholder'`          | App starts without it                                                                                                                                 |
| `GITHUB_CLIENT_ID`       | No       | `'placeholder'`          | App starts without it                                                                                                                                 |
| `GITHUB_CLIENT_SECRET`   | No       | `'placeholder'`          | App starts without it                                                                                                                                 |
| `GROQ_API_KEY`           | Yes\*    | —                        | Required for company enrichment; app starts without it but enrichment will fail                                                                       |
| `TAVILY_API_KEY`         | Yes\*    | —                        | Required for company enrichment; returns [] snippets if unset (free tier: 1000 req/month at app.tavily.com)                                           |
| `REDIS_URL`              | No       | `redis://localhost:6379` | BullMQ connection for the enrichment and notifications queues; also backs the short-lived OAuth exchange-code store in `AuthService`                  |
| `RESEND_API_KEY`         | No       | —                        | Required to actually send emails; unset → `EmailService` logs and no-ops instead of sending (app still boots)                                         |
| `EMAIL_FROM`             | No       | `onboarding@resend.dev`  | Sender address for reminder/digest emails; the default only delivers to the Resend account owner — set a verified domain for real users               |
| `LOG_LEVEL`              | No       | `info`                   | Pino log level. Set `debug` to log the full LLM context per enrichment run (`enrichment_context`) — the primary tool for diagnosing wrong extractions |
| `STORAGE_DRIVER`         | No       | `local`                  | `local` or `oracle` — selects the storage backend at startup                                                                                          |
| `OCI_NAMESPACE`          | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`                                                                                                                 |
| `OCI_REGION`             | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`                                                                                                                 |
| `OCI_BUCKET_NAME`        | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`                                                                                                                 |
| `OCI_ACCESS_KEY_ID`      | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`; Customer Secret Key from OCI console                                                                           |
| `OCI_SECRET_ACCESS_KEY`  | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`; Customer Secret Key from OCI console                                                                           |

---

## Database Schema

Key relationships: `User → Job[] → JobEvent[]`, `User → Account[]`, `User → RefreshToken[]`, `Job → CompanyProfile?`, `Job → Resume?`. `Job.events` is populated automatically: a `CREATED` event is inserted on job create; a `STATUS_CHANGE` event (with `fromStatus`/`toStatus`) is inserted whenever `PATCH /jobs/:id` changes the status field. `Account` stores OAuth provider linkage with a compound unique on `[provider, providerAccountId]`. `RefreshToken` is a separate table (not a column on `User`) — each row has a bcrypt-hashed token, expiry, and cascades on user delete. `CompanyProfile` is a 1:1 optional relation to `Job` holding enrichment status (`EnrichmentStatus` enum) and extracted fields (industry, techStack, cultureSummary, etc.), with cascade delete. `Resume` is a 1:1 optional relation to `Job` — one PDF per job, stored by key in the configured storage driver; `storageKey` is never sent to the client.

---

## Error Handling

- Throw NestJS built-in exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`) — `GlobalExceptionFilter` passes them through unchanged.
- Do **not** throw plain `Error` objects — they fall through to the 500 catch-all.
- `GlobalExceptionFilter` catches `P2002` (unique) → 409, `P2025` (not found) → 404.
- Use `ValidationPipe` errors for DTO validation failures — these are automatic.

---

## Rate Limiting

Global `ThrottlerGuard` (`app.module.ts`, `ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])`): 100 requests per 60s window per client, applied to every route by default. Hardcoded, not env-configurable. A client (including a test suite hammering the API) that exceeds this gets a 429 — if you see unexplained 429s in local testing or e2e runs, this is why.

A few routes tighten this with `@Throttle(...)`: `POST /jobs/parse` (external LLM/search cost per call) caps at 10/min in every environment. `POST /auth/token/exchange` (unauthenticated, brute-forceable) caps at 10/min in production only — 100/min in dev, so local testing isn't throttled. `POST /companies/import` (bulk CSV write) also caps at 10/min. `GET /companies/duplicates` (O(n²) pairwise scan) deliberately has **no** route-specific throttle — it's fetched passively on every companies-page mount, and a 10/min cap broke ordinary navigation in e2e; `MAX_COMPANIES_PER_USER` bounds its worst-case cost instead, so it relies on the generic 100/min guard. See ADR-029.

---

## Logging

`nestjs-pino` is wired globally. Use the injected `Logger` in services if you need explicit log lines:

```ts
import { Logger } from 'nestjs-pino';

constructor(private logger: Logger) {}

this.logger.log('Job created', { jobId });
```

Fields automatically redacted from logs: `req.headers.authorization`, `req.body.password`, `req.body.currentPassword`, `req.body.newPassword`, `req.body.refreshToken`.

---

## E2E Tests (`test/app.e2e-spec.ts`)

- Run against the **live dev database** — no mocking.
- Each run uses a unique email: `e2e-${Date.now()}@test.dev`.
- `afterAll` deletes that user (cascades to all jobs and events).
- Test setup in `beforeAll` manually mirrors `main.ts` — if `main.ts` adds a global pipe/guard/filter, add it to the test setup too.
