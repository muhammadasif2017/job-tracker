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

---

## Module Structure

```
src/
├── main.ts                  # Bootstrap: helmet, CORS, ValidationPipe, JwtAuthGuard, PrismaExceptionFilter, Swagger
├── app.module.ts            # Root module: ConfigModule, ThrottlerModule, LoggerModule, feature modules
├── prisma/
│   ├── prisma.module.ts     # Global PrismaModule (exports PrismaService)
│   └── prisma.service.ts    # Extends PrismaClient with PrismaPg adapter
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts   # /auth/* routes
│   ├── auth.service.ts      # issueTokens, register, login, refresh, logout, OAuth
│   ├── dto/
│   └── strategies/          # local, jwt, jwt-refresh, google, github
├── users/
│   ├── users.controller.ts  # /users/* routes
│   ├── users.service.ts     # getProfile, updateProfile, changePassword, deleteAccount
│   └── dto/
├── jobs/
│   ├── jobs.controller.ts   # /jobs/* routes
│   ├── jobs.service.ts      # CRUD, stats, CSV export, event logging
│   └── dto/
└── common/
    ├── decorators/
    │   ├── public.decorator.ts      # @Public() — skips JwtAuthGuard
    │   └── current-user.decorator.ts # @CurrentUser() — extracts req.user
    ├── guards/
    │   └── jwt-auth.guard.ts        # Global guard; respects @Public()
    └── filters/
        └── prisma-exception.filter.ts # Maps P2002→409, P2025→404
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
- **Refresh token** — 7 days, signed with `JWT_REFRESH_SECRET`. Sent in request body. Stored as a **bcrypt hash** in `User.refreshToken`.

On every refresh, both tokens are rotated (new pair issued, old hash overwritten).

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
  → storeOAuthCode(tokens) → short-lived UUID in memory Map (60s)
  → redirect to ${FRONTEND_URL}/callback?code=<uuid>
  → Frontend: POST /auth/exchange-code { code } → { accessToken, refreshToken }
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

## Environment Variables

| Variable                 | Required | Default                 | Notes                                                                  |
| ------------------------ | -------- | ----------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`           | Yes      | —                       | PostgreSQL connection string                                           |
| `PORT`                   | No       | `3001`                  |                                                                        |
| `JWT_SECRET`             | Yes      | —                       | Min 32 chars                                                           |
| `JWT_REFRESH_SECRET`     | Yes      | —                       | Min 32 chars                                                           |
| `JWT_EXPIRES_IN`         | No       | `15m`                   |                                                                        |
| `JWT_REFRESH_EXPIRES_IN` | No       | `7d`                    |                                                                        |
| `FRONTEND_URL`           | No       | `http://localhost:3000` | Used for CORS and OAuth redirect                                       |
| `BACKEND_URL`            | No       | `http://localhost:3001` | Backend origin used to build OAuth callback URLs sent to Google/GitHub |
| `GOOGLE_CLIENT_ID`       | No       | `'placeholder'`         | App starts without it                                                  |
| `GOOGLE_CLIENT_SECRET`   | No       | `'placeholder'`         | App starts without it                                                  |
| `GITHUB_CLIENT_ID`       | No       | `'placeholder'`         | App starts without it                                                  |
| `GITHUB_CLIENT_SECRET`   | No       | `'placeholder'`         | App starts without it                                                  |

---

## Error Handling

- Throw NestJS built-in exceptions (`NotFoundException`, `ForbiddenException`, `BadRequestException`) — `PrismaExceptionFilter` passes them through unchanged.
- Do **not** throw plain `Error` objects — they fall through to the 500 catch-all.
- `PrismaExceptionFilter` catches `P2002` (unique) → 409, `P2025` (not found) → 404.
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
