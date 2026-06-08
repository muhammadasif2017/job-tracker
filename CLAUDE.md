# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (`/backend`)
```bash
npm run start:dev       # watch mode on :3001
npm run build           # compile to dist/
npm run test:e2e        # e2e suite (requires local PostgreSQL on :5432)
npx tsc --noEmit        # type check only
npx prisma migrate dev --name <name>   # create + apply migration
npx prisma generate     # regenerate client after schema change (must run after every migrate)
npx prisma studio       # GUI DB browser
```

### Frontend (`/frontend`)
```bash
npm run dev             # Next.js dev server on :3000
npm run build           # production build
npm run lint            # ESLint
```

## Architecture

### Backend (NestJS 11)

**Module structure:** `AppModule` → `PrismaModule` (global), `AuthModule`, `UsersModule`, `JobsModule`. Each feature module owns its controller, service, and `dto/` folder.

**Prisma 7 quirks — critical:**
- The datasource block has **no `url` field** (Prisma 7 removed it from schema). The connection is wired at runtime via `@prisma/adapter-pg`: `new PrismaPg({ connectionString: process.env.DATABASE_URL })` passed to `super({ adapter })` in `PrismaService`.
- After every `prisma migrate dev`, run `prisma generate` — the TypeScript client types (including new enums) are not updated by migrate alone.
- `prisma.config.ts` at the backend root is Prisma 7's required config file.

**Auth flow:**
- Global `JwtAuthGuard` protects all routes by default; opt out with `@Public()`.
- Two JWTs: access token (15 min, `JWT_SECRET`) + refresh token (7 days, `JWT_REFRESH_SECRET`). Refresh tokens are bcrypt-hashed before storage in `User.refreshToken`.
- OAuth (Google/GitHub): `GET /auth/google` → provider → `GET /auth/google/callback` → redirect to `${FRONTEND_URL}/callback?accessToken=x&refreshToken=y`. Strategies use `?? 'placeholder'` so the server starts without real OAuth credentials.
- `issueTokens` is the single method that signs both tokens, hashes+stores the refresh token, and returns the pair.

**Error handling:** Global `PrismaExceptionFilter` maps P2002 → 409, P2025 → 404, and passes NestJS `HttpException` subclasses through unchanged.

**Logging:** `nestjs-pino` via `LoggerModule.forRoot()` in `AppModule`. In dev it pretty-prints (set by `NODE_ENV !== 'production'`). Authorization headers are redacted from request logs.

**TypeScript imports:** All source imports use `.js` extensions (`import { X } from './foo.js'`) due to ESM conventions. This is intentional — NestJS compiles to CJS but the source uses ESM-style paths. The e2e `jest-e2e.json` has a `moduleNameMapper` that strips `.js` so ts-jest can resolve them as `.ts` files. When typing decorated method parameters, use `import type` for Express types (`Request`, `Response`) to satisfy `isolatedModules`.

### Frontend (Next.js 16 App Router)

**Routing — important:**
- **`proxy.ts`** (not `middleware.ts`) with `export function proxy()` (not `middleware`) — Next.js 16 renamed the convention. Handles route protection by checking the `jt_authed` cookie.
- Route groups `(auth)` and `(dashboard)` do **not** add path segments. `app/(auth)/callback/page.tsx` routes to `/callback`, not `/auth/callback`. Always account for this when referencing URL paths.

**Auth state split across two layers:**
1. `lib/auth.ts` — `tokenStorage` reads/writes `localStorage` keys `jt_access`/`jt_refresh`. Used by the Axios interceptor.
2. `store/auth.store.ts` — Zustand + persist for `user` and `isAuthenticated`. Also manages the `jt_authed` cookie (set on `setAuth`, cleared on `logout`) which is the signal `proxy.ts` reads.
3. `lib/api.ts` — Axios instance with a request interceptor (attaches Bearer token) and a response interceptor (queues 401s, calls refresh, retries; redirects to `/login` on failure).

**Data fetching:** TanStack Query v5 with `staleTime: 60_000`. Query keys follow the pattern `['jobs', filters]`, `['job', id]`, `['job-events', id]`, `['stats']`. Mutations invalidate related query keys on success.

**Forms:** React Hook Form + Zod. Schemas are defined inline in the component file. The `JobForm` component handles both create (POST `/jobs`) and edit (PATCH `/jobs/:id`).

### E2E Tests

Tests in `backend/test/app.e2e-spec.ts` run against the **live dev database**. Each test run uses a unique timestamped email (`e2e-${Date.now()}@test.dev`). `afterAll` deletes that user (cascades to all their jobs and events). The test setup in `beforeAll` manually applies the same global pipes, guards, and filters as `main.ts` — if `main.ts` changes, update the test setup too.

### Database Schema

Key relationships: `User → Job[] → JobEvent[]`, `User → Account[]`. `Job.events` is populated automatically: a `CREATED` event is inserted on job create; a `STATUS_CHANGE` event (with `fromStatus`/`toStatus`) is inserted whenever `PATCH /jobs/:id` changes the status field. `Account` stores OAuth provider linkage with a compound unique on `[provider, providerAccountId]`.


# CLAUDE.md

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