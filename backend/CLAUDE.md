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

## Module Structure

```
src/
├── main.ts                  # Bootstrap: helmet, CORS, ValidationPipe, JwtAuthGuard, GlobalExceptionFilter, Swagger
├── app.module.ts            # Root module: ConfigModule, ThrottlerModule, LoggerModule, feature modules
├── prisma/
│   ├── prisma.module.ts     # Global PrismaModule (exports PrismaService)
│   └── prisma.service.ts    # Extends PrismaClient with PrismaPg adapter
├── storage/
│   ├── storage.module.ts    # Global StorageModule — factory picks driver from STORAGE_DRIVER env var
│   ├── storage.service.ts   # IStorageService interface + STORAGE_SERVICE injection token
│   ├── local-storage.service.ts   # Dev driver: writes files to uploads/ on disk
│   └── oracle-storage.service.ts  # Prod driver: Oracle Cloud Object Storage (S3-compatible)
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts   # /auth/* routes
│   │   ├── auth.service.ts      # issueTokens, register, login, refresh, logout, OAuth
│   │   ├── dto/
│   │   └── strategies/          # local, jwt, jwt-refresh, google, github
│   ├── users/
│   │   ├── users.controller.ts  # /users/* routes
│   │   ├── users.service.ts     # getProfile, updateProfile, changePassword, deleteAccount
│   │   └── dto/
│   ├── jobs/
│   │   ├── jobs.controller.ts   # /jobs/* routes
│   │   ├── jobs.service.ts      # CRUD, stats, CSV export, event logging
│   │   └── dto/
│   ├── resumes/
│   │   ├── resumes.module.ts
│   │   ├── resumes.controller.ts  # POST/GET/DELETE /jobs/:jobId/resumes, GET /jobs/resumes/file
│   │   ├── resumes.service.ts     # upload, getPresignedUrl, findByJob, remove
│   │   └── dto/
│   ├── enrichment/           # BullMQ queue + processor for async company data enrichment
│   └── health/
└── common/
    ├── decorators/
    │   ├── public.decorator.ts      # @Public() — skips JwtAuthGuard
    │   └── current-user.decorator.ts # @CurrentUser() — extracts req.user
    ├── guards/
    │   └── jwt-auth.guard.ts        # Global guard; respects @Public()
    └── filters/
        └── global-exception.filter.ts # Maps P2002→409, P2025→404; passes HttpExceptions through; 500 for all else
```

---

## Prisma 7 Quirks

- **No `url` field in `datasource db {}`** — connection is wired at runtime:
  ```ts
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  super({ adapter });
  ```
- `prisma.config.ts` at the backend root is Prisma 7's required config file — do not delete it.
- Always run `prisma generate` after any schema change or migration.

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

`AuthService.cleanupExpiredRefreshTokens` (`@Cron(EVERY_DAY_AT_MIDNIGHT)`, via `@nestjs/schedule`'s `ScheduleModule.forRoot()` in `AppModule`) deletes rows past `expiresAt` — both naturally expired and soft-revoked rows accumulate until this runs.

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

## Jobs: Authorization Pattern

Every service method that operates on a specific job calls `findOne(userId, jobId)` first. This throws `ForbiddenException` if the job belongs to a different user. Never skip this check:

```ts
async update(userId: string, jobId: string, dto: UpdateJobDto) {
  const existing = await this.findOne(userId, jobId); // ownership check
  // ...
}
```

## Jobs: Event Logging

Events are written inside the same Prisma operation as the job mutation — never in a separate call:

```ts
// On create:
events: { create: { type: JobEventType.CREATED, toStatus: initialStatus } }

// On status change:
events: { create: { type: JobEventType.STATUS_CHANGE, fromStatus: existing.status, toStatus: dto.status } }
```

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

1. `nest g module feature`
2. `nest g controller feature`
3. `nest g service feature`
4. Add DTOs in `feature/dto/`
5. Import `PrismaModule` if needed (it's global — no need to import it)
6. Protect routes with `JwtAuthGuard` by default (already global); add `@Public()` only for truly public endpoints
7. Use `@CurrentUser()` to get the authenticated user — never trust user IDs from the request body
8. Add the new module to `AppModule.imports`

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
| `REDIS_URL`              | No       | `redis://localhost:6379` | BullMQ connection for the enrichment queue; also backs the short-lived OAuth exchange-code store in `AuthService`                                     |
| `LOG_LEVEL`              | No       | `info`                   | Pino log level. Set `debug` to log the full LLM context per enrichment run (`enrichment_context`) — the primary tool for diagnosing wrong extractions |
| `STORAGE_DRIVER`         | No       | `local`                  | `local` or `oracle` — selects the storage backend at startup                                                                                          |
| `OCI_NAMESPACE`          | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`                                                                                                                 |
| `OCI_REGION`             | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`                                                                                                                 |
| `OCI_BUCKET_NAME`        | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`                                                                                                                 |
| `OCI_ACCESS_KEY_ID`      | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`; Customer Secret Key from OCI console                                                                           |
| `OCI_SECRET_ACCESS_KEY`  | Yes\*    | —                        | Required when `STORAGE_DRIVER=oracle`; Customer Secret Key from OCI console                                                                           |

---

## Error Handling

- Throw NestJS built-in exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`) — `GlobalExceptionFilter` passes them through unchanged.
- Do **not** throw plain `Error` objects — they fall through to the 500 catch-all.
- `GlobalExceptionFilter` catches `P2002` (unique) → 409, `P2025` (not found) → 404.
- Use `ValidationPipe` errors for DTO validation failures — these are automatic.

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

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes m;;''ade unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
