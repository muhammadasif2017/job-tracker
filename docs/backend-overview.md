# Backend Overview

## Database Schema

The core ownership graph is:

```
User ──< Job ──< JobEvent
  │       ├── 1:1 CompanyProfile
  │       ├── 1:1 Resume
  │       ├── 1:N InterviewRound
  │       └── 1:N Contact
  ├──< Account
  └──< RefreshToken
```

- **User** — email/password (nullable for OAuth users). Refresh tokens live in the separate `RefreshToken` table (bcrypt-hashed `tokenHash`, `expiresAt`, cascades on user delete) — there is no `refreshToken` field on `User`.
- **Account** — links a User to an OAuth provider. Compound unique on `[provider, providerAccountId]` so one user can link multiple providers.
- **Job** — the core entity. `JobStatus` enum: `WISHLIST | APPLIED | INTERVIEWING | OFFER | REJECTED | GHOSTED`.
- **JobEvent** — audit log with `CREATED`, `STATUS_CHANGE`, and `INTERVIEW_ROUND_ADDED` events. Stores `fromStatus`/`toStatus`. Events are created by the relevant service inside the same database unit of work as the mutation.
- **CompanyProfile** — optional one-to-one enrichment result for a job. Its `EnrichmentStatus` tracks queue progress.
- **Resume** — optional one-to-one uploaded resume with a pluggable storage key.
- **InterviewRound** and **Contact** — one-to-many job children, both ownership-scoped through their parent job.

---

## Bootstrap (`src/main.ts`)

Global concerns applied in order before the server listens:

| What | Why |
|---|---|
| `helmet()` | Security headers |
| `enableCors` | Allows only `FRONTEND_URL` origin |
| `ValidationPipe` | Strips unknown fields (`whitelist: true`), auto-transforms types (`transform: true`) |
| `JwtAuthGuard` | Protects ALL routes by default |
| `PrismaExceptionFilter` | Maps Prisma DB errors to HTTP status codes |

Swagger only wired in non-production at `/api/docs`.

---

## `AppModule`

| Module | Role |
|---|---|
| `ConfigModule` | Global, Joi-validates `.env` at startup — crashes if required vars missing |
| `ThrottlerModule` | 100 req/60s globally; auth endpoints override to 10 req/min in production |
| `LoggerModule` (nestjs-pino) | Structured JSON logging; redacts `authorization`, `password`, `refreshToken` fields |
| `PrismaModule` | Global DB client |
| `AuthModule`, `UsersModule`, `JobsModule` | Core feature modules |
| `EnrichmentModule` | BullMQ company research pipeline and external web/LLM services |
| `NotificationsModule` | BullMQ email processor and scheduled reminders/digests |
| `StorageModule` | Local-disk or Oracle Object Storage implementation |
| `ResumesModule`, `InterviewRoundsModule`, `ContactsModule` | Job child-resource APIs |
| `AdminModule`, `HealthModule` | Administrative operations and health checks |

---

## PrismaService

Extends `PrismaClient` directly — every service injecting it gets the full query API.  
Prisma 7 quirk: no `url` field in schema. DB connection is wired via `new PrismaPg({ connectionString })` passed to `super({ adapter })`. Connects on `onModuleInit`, disconnects on `onModuleDestroy`.

---

## Auth System

### Five Passport Strategies

| Strategy | Name | How it validates |
|---|---|---|
| `LocalStrategy` | `'local'` | bcrypt-compares email/password, attaches user to `req.user` |
| `JwtStrategy` | `'jwt'` | Bearer token from `Authorization` header, verifies with `JWT_SECRET`, fetches user from DB |
| `JwtRefreshStrategy` | `'jwt-refresh'` | Token from the `jt_refresh` HttpOnly cookie, verifies with `JWT_REFRESH_SECRET` |
| `GoogleStrategy` | `'google'` | OAuth 2.0, calls `handleOAuthUser` after redirect |
| `GithubStrategy` | `'github'` | Same as Google |

### `JwtAuthGuard`

Global guard. Checks `IS_PUBLIC_KEY` metadata: if a route has `@Public()`, it short-circuits without any token check. Otherwise delegates to `AuthGuard('jwt')`.

### `AuthService` Key Methods

- **`issueTokens`** (private) — single source of truth. Signs both tokens in parallel, bcrypt-hashes the refresh token, saves to DB. Returns `{ accessToken, refreshToken }`.
- **`register`** — hashes password, creates user, calls `issueTokens`.
- **`validateLocalUser`** — called by `LocalStrategy`. Returns user or null.
- **`refresh`** — looks up `RefreshToken` by `jti` (JWT ID claim), validates `userId` and `expiresAt`, bcrypt-compares the raw token against `tokenHash`, atomically marks the used row revoked, and issues a new token pair via `issueTokens`.
- **`logout`** — `deleteMany` on `RefreshToken` for the user, invalidating all sessions across all devices.
- **`handleOAuthUser`** — looks up by `Account`, rejects silent linking to an existing password account, links passwordless users by email, or creates a new user. All paths end with `issueTokens`.
- **`storeOAuthCode` / `exchangeOAuthCode`** — one-time code pattern. After OAuth callback, tokens are stored in Redis under a UUID key with a 60-second expiry. The frontend exchanges the code via `POST /auth/exchange-code`; only the opaque code appears in the redirect URL.

---

## Jobs Module

### Authorization Pattern

Every method touching a specific job scopes the lookup by both `userId` and `jobId`. A missing or foreign job returns the same `404`, so users cannot discover each other's records.

### Key Service Behaviors

- **`findAll`** — dynamic `where` clause: optional status filter, case-insensitive OR search on `company`/`position`, date range on `appliedAt`. Returns `{ data, meta: { total, page, limit, totalPages } }`.
- **`update`** — if status changes, uses a compare-and-set update and a Prisma transaction to write the `STATUS_CHANGE` event safely alongside the mutation.
- **`parseJobPosting`** — owned by `JobParsingService`, a sibling provider in `JobsModule`. Fetches a supplied URL, falls back to search snippets when necessary, and asks Groq for structured job fields. Synchronous convenience endpoint with explicit frontend timeouts.
- **`getStats`, `getFunnel`, `getTrend`, and `getAttention`** — owned by `JobsStatsService`, which keeps analytics queries separate from job CRUD.
- **`exportCsv`** — up to 1,000 jobs, with quote escaping and spreadsheet-formula injection protection. Controller sets `Content-Type: text/csv` and `Content-Disposition` headers.

### API Endpoints

```
POST   /jobs
GET    /jobs          ?page&limit&sortBy&sortOrder&search&status&dateFrom&dateTo
GET    /jobs/stats
GET    /jobs/export   ?search&status&dateFrom&dateTo
GET    /jobs/:id
GET    /jobs/:id/events
PATCH  /jobs/:id
DELETE /jobs/:id
```

---

## Users Module

Three operations on the authenticated user:

- **`getProfile`** — selects `accounts` to derive `connectedProviders: ['google', 'github']`, strips raw `accounts` from response.
- **`updateProfile`** — checks email uniqueness excluding current user.
- **`changePassword`** — rejects if user has no password (OAuth-only account).
- **`deleteAccount`** — deletes user; cascades to all jobs and events via DB schema.

---

## Common Infrastructure

### Decorators

- `@Public()` — sets `IS_PUBLIC_KEY` metadata; causes `JwtAuthGuard` to skip token check.
- `@CurrentUser()` — parameter decorator that extracts `req.user` (populated by `JwtStrategy.validate()`).

### `PrismaExceptionFilter`

Catches all exceptions globally. Passes NestJS `HttpException` subclasses through unchanged. Maps:
- `P2002` (unique violation) → 409 Conflict
- `P2025` (record not found) → 404 Not Found
- Anything else → 500 Internal Server Error

---

## Data Flow

```
Request
  → ThrottlerGuard (rate limit)
  → JwtAuthGuard (verify JWT, attach user)
  → ValidationPipe (strip + transform body)
  → Controller (@CurrentUser extracts user)
  → Service (ownership check + business logic)
  → PrismaService (DB query)
  → PrismaExceptionFilter (if DB error)
  → Response
```
