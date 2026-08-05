# Backend Overview

## Database Schema

Four models, three relationships:

```
User ──< Job ──< JobEvent
User ──< Account
```

- **User** — email/password (nullable for OAuth users). Refresh tokens live in the separate `RefreshToken` table (bcrypt-hashed `tokenHash`, `expiresAt`, cascades on user delete) — there is no `refreshToken` field on `User`.
- **Account** — links a User to an OAuth provider. Compound unique on `[provider, providerAccountId]` so one user can link multiple providers.
- **Job** — the core entity. `JobStatus` enum: `WISHLIST | APPLIED | INTERVIEWING | OFFER | REJECTED | GHOSTED`.
- **JobEvent** — audit log. Two types: `CREATED` (on job create) and `STATUS_CHANGE` (on status update). Stores `fromStatus`/`toStatus`. Never created manually by callers — the service writes them automatically inside the same Prisma transaction using nested `create`.

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
| `AuthModule`, `UsersModule`, `JobsModule` | Feature modules |

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
| `JwtRefreshStrategy` | `'jwt-refresh'` | Token from request **body** (`req.body.refreshToken`), verifies with `JWT_REFRESH_SECRET` |
| `GoogleStrategy` | `'google'` | OAuth 2.0, calls `handleOAuthUser` after redirect |
| `GithubStrategy` | `'github'` | Same as Google |

### `JwtAuthGuard`

Global guard. Checks `IS_PUBLIC_KEY` metadata: if a route has `@Public()`, it short-circuits without any token check. Otherwise delegates to `AuthGuard('jwt')`.

### `AuthService` Key Methods

- **`issueTokens`** (private) — single source of truth. Signs both tokens in parallel, bcrypt-hashes the refresh token, saves to DB. Returns `{ accessToken, refreshToken }`.
- **`register`** — hashes password, creates user, calls `issueTokens`.
- **`validateLocalUser`** — called by `LocalStrategy`. Returns user or null.
- **`refresh`** — looks up `RefreshToken` by `jti` (JWT ID claim), validates `userId` and `expiresAt`, bcrypt-compares the raw token against `tokenHash`, deletes the used row, issues new token pair via `issueTokens`.
- **`logout`** — `deleteMany` on `RefreshToken` for the user, invalidating all sessions across all devices.
- **`handleOAuthUser`** — looks up by `Account`, then by email (links account), then creates new user. All paths end with `issueTokens`.
- **`storeOAuthCode` / `exchangeOAuthCode`** — one-time code pattern. After OAuth callback, tokens are stored in an in-memory `Map` keyed by UUID (60s TTL). Frontend exchanges the code for tokens via `POST /auth/exchange-code`. Avoids exposing tokens in the redirect URL.

---

## Jobs Module

### Authorization Pattern

Every method touching a specific job calls `findOne(userId, jobId)` first, which throws `ForbiddenException` if `job.userId !== userId`. Users can never access each other's data.

### Key Service Behaviors

- **`findAll`** — dynamic `where` clause: optional status filter, case-insensitive OR search on `company`/`position`, date range on `appliedAt`. Returns `{ data, meta: { total, page, limit, totalPages } }`.
- **`update`** — if status changes, writes a `STATUS_CHANGE` event in the same Prisma operation via nested `events: { create: {...} }`.
- **`getStats`** — three parallel queries (`Promise.all`): groupBy status, total count, this-month count. `responseRate = (interviewing + offer + rejected) / total * 100`.
- **`exportCsv`** — up to 10,000 jobs, quote-escaped CSV string. Controller sets `Content-Type: text/csv` and `Content-Disposition` headers.

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
