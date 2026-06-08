# Job Tracker — Backend

NestJS 11 REST API for the Job Tracker project. See the [root README](../README.md) for full setup, Docker, and API documentation.

## Commands

```bash
npm run start:dev        # watch mode on :3001
npm run build            # compile to dist/
npm run test:e2e         # e2e suite (requires local PostgreSQL on :5432)
npx tsc --noEmit         # type check only

npx prisma migrate dev --name <name>   # create + apply migration
npx prisma generate                    # regenerate client after schema change
npx prisma studio                      # GUI DB browser
```

## Module structure

```
src/
├── auth/           # Register, login, refresh, logout, Google & GitHub OAuth
│   ├── dto/        # RegisterDto, LoginDto, RefreshDto, ExchangeCodeDto
│   └── strategies/ # Local, JWT, JWT-Refresh, Google, GitHub
├── jobs/           # Job CRUD, stats, CSV export, event timeline
│   └── dto/        # CreateJobDto, UpdateJobDto, JobQueryDto
├── users/          # Profile, password change, account deletion
│   └── dto/        # UpdateUserDto, ChangePasswordDto
├── prisma/         # PrismaService (global)
└── common/
    ├── decorators/ # @Public(), @CurrentUser()
    ├── guards/     # JwtAuthGuard (global)
    └── filters/    # PrismaExceptionFilter (P2002 → 409, P2025 → 404)
```

## Key design notes

- **Global guards** — `JwtAuthGuard` and `ThrottlerGuard` are registered globally via `APP_GUARD`. Auth routes opt out with `@Public()`.
- **Prisma 7** — no `url` field in the datasource block; connection is wired via `@prisma/adapter-pg` in `PrismaService`. Run `prisma generate` after every migration.
- **Auth tokens** — access token (15 min, `JWT_SECRET`) + refresh token (7 days, `JWT_REFRESH_SECRET`). Refresh tokens are bcrypt-hashed before storage. `issueTokens()` is the single code path that signs, hashes, stores, and returns both tokens.
- **OAuth flow** — provider callbacks issue a short-lived one-time code (60 s, in-memory). The frontend exchanges it via `POST /auth/exchange-code`. Tokens never appear in redirect URLs.
- **Rate limiting** — global 100 req/60 s; auth endpoints (`/auth/register`, `/auth/login`) override to 10 req/60 s via `@Throttle()`.
- **Logging** — `nestjs-pino` with `autoLogging: true`. Authorization headers, passwords, and refresh tokens are redacted. Pretty-print in dev, JSON in production.

## E2E tests

Tests run against the live dev database. Each run creates a user with a timestamped email (`e2e-${Date.now()}@test.dev`) and deletes it in `afterAll` (cascades to all owned jobs and events).

```bash
npm run test:e2e
```
