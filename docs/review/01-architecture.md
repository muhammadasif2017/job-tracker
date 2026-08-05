# Job Tracker — Architecture & Decision Walkthrough

> Purpose: a single document that explains *how the project is built* and *why each
> decision was made*, so you can reason about it confidently in interviews and
> design discussions. It is descriptive (what exists today), paired with
> `02-code-review.md` (what could be improved) and `03-interview-guide.md`
> (how to talk about it).

---

## 1. The one-paragraph summary

Job Tracker is a full-stack application for tracking job applications through a
hiring pipeline (Wishlist → Applied → Interviewing → Offer → Rejected → Ghosted).
The **backend** is a NestJS 11 REST API backed by PostgreSQL via Prisma 7, with
JWT + OAuth authentication. The **frontend** is a Next.js 16 (App Router) SPA-style
dashboard using TanStack Query for server state, Zustand for auth state, and
Tailwind for styling. It deploys as Docker containers on a single VM (backend +
Caddy for TLS) with the frontend on Vercel and PostgreSQL on Neon — all chosen to
stay inside free tiers.

---

## 2. The stack and *why each piece*

| Concern | Choice | Why this choice |
| --- | --- | --- |
| API framework | **NestJS 11** | Opinionated DI + module structure; decorators give clean controllers; batteries-included guards/pipes/filters. Signals "I can work in structured, enterprise-style codebases." |
| ORM | **Prisma 7** | Type-safe queries, declarative schema, first-class migrations. Prisma 7 is bleeding-edge (driver-adapter model) — a deliberate signal of staying current. |
| DB | **PostgreSQL** | Relational data with clear FKs (User→Job→JobEvent), enums for status, transactional integrity. |
| Auth | **JWT access/refresh + Passport OAuth** | Stateless access tokens for scale; rotating refresh tokens for security; OAuth for low-friction signup. |
| Frontend | **Next.js 16 App Router** | Modern React (Server Components capable), file-based routing, route groups, built-in middleware (`proxy.ts`). |
| Server state | **TanStack Query v5** | Caching, background refetch, invalidation, optimistic updates — removes hand-rolled fetch/loading/error code. |
| Client state | **Zustand + persist** | Tiny, no boilerplate, persists auth across reloads. |
| Forms | **React Hook Form + Zod** | Uncontrolled inputs (fast) + schema validation shared as types. |
| Styling | **Tailwind v4** | Utility-first, dark mode via `class`, no separate CSS files. |
| Deploy | **Docker + Caddy on a single VM, Vercel for FE, Neon for DB** | Free-tier constraint; Caddy auto-provisions Let's Encrypt TLS; managed DB removes a stateful container. |

The recurring theme: **modern, type-safe, free-tier-deployable, and structured
the way a production team would do it.** That is the portfolio narrative.

---

## 3. Backend architecture (NestJS)

### 3.1 Module graph

```
AppModule
├── ConfigModule (global, Joi-validated env)
├── ThrottlerModule (global rate limit: 100 req / 60s)
├── LoggerModule (nestjs-pino, redacts secrets)
├── BullModule.forRoot (Redis-backed queue)
├── PrismaModule (global → exports PrismaService)
├── AuthModule       → AuthController, AuthService, 5 Passport strategies
├── UsersModule      → UsersController, UsersService
├── JobsModule       → JobsController, JobsService
├── HealthModule     → HealthController (Terminus DB ping)
└── EnrichmentModule → EnrichmentController, EnrichmentService, EnrichmentProcessor
                       └── Services: WebFetchService, SearchService, LlmService
```

Each feature module owns a **controller** (HTTP layer), a **service** (business
logic + DB), and a **`dto/`** folder (request validation contracts). This is the
canonical NestJS layering and is the first thing an interviewer will recognize.

### 3.2 The request lifecycle (the diagram to draw on a whiteboard)

```
HTTP request
   │
   ▼
[helmet]              security headers           (main.ts:17)
   │
[CORS]               origin = FRONTEND_URL       (main.ts:18)
   │
[ThrottlerGuard]     global rate limit           (app.module.ts:54)
   │
[JwtAuthGuard]       global auth, unless @Public  (main.ts:28)
   │  └─ on success: req.user = { id, email, name, avatarUrl }
   ▼
[ValidationPipe]     whitelist + transform DTO    (main.ts:20)
   │
   ▼
Controller method  →  Service method  →  Prisma  →  PostgreSQL
   │
   ▼
[PrismaExceptionFilter]  maps errors to HTTP codes (main.ts:29)
   │
   ▼
HTTP response (JSON)
```

**Decision — global guard, opt-out instead of opt-in.** `JwtAuthGuard` is
registered globally in `main.ts:28`, so *every route is protected by default*.
Public endpoints (`login`, `register`, OAuth, health) explicitly opt out with
`@Public()` (`common/decorators/public.decorator.ts`). The guard reads that
metadata via the `Reflector` and short-circuits (`jwt-auth.guard.ts:13-18`). This
is the **safe default**: forgetting an annotation leaves a route *locked*, not
*open*. That single sentence is a strong security talking point.

**Decision — `ValidationPipe` with `whitelist + forbidNonWhitelisted +
transform`** (`main.ts:20-26`):
- `whitelist` strips properties not in the DTO (defense against mass-assignment).
- `forbidNonWhitelisted` rejects unknown properties with 400 (stricter — tells
  the client they sent garbage).
- `transform` turns the plain body into a typed DTO instance and coerces query
  strings to numbers (see `@Type(() => Number)` in `job-query.dto.ts`).

### 3.3 Authentication — the heart of the backend

There are **five Passport strategies**, each a small adapter:

| Strategy | File | Triggered by | Returns into `req.user` |
| --- | --- | --- | --- |
| `local` | `local.strategy.ts` | `POST /auth/login` | full user (after bcrypt compare) |
| `jwt` | `jwt.strategy.ts` | every protected route | `{ id, email, name, avatarUrl }` |
| `jwt-refresh` | `jwt-refresh.strategy.ts` | `POST /auth/refresh` | `{ sub, email, refreshToken }` |
| `google` | `google.strategy.ts` | `GET /auth/google/callback` | `{ accessToken, refreshToken }` |
| `github` | `github.strategy.ts` | `GET /auth/github/callback` | `{ accessToken, refreshToken }` |

**Decision — two tokens, asymmetric storage.** `issueTokens()`
(`auth.service.ts:116-137`) is the *single* place that mints credentials:

- **Access token**: 15 min, signed with `JWT_SECRET`, sent as a Bearer header.
  Short-lived so a stolen one expires fast.
- **Refresh token**: 7 days, signed with a *different* secret
  (`JWT_REFRESH_SECRET`), sent in the request body. It is **bcrypt-hashed before
  being stored** in `User.refreshToken`. So even a full DB leak doesn't hand an
  attacker a usable refresh token — they'd have the hash, not the token.

**Decision — refresh rotation.** Every refresh re-runs `issueTokens`, which signs
a new pair and overwrites the stored hash (`auth.service.ts:51-59`). A refresh
token is single-use; replaying an old one fails the bcrypt compare. Logout simply
nulls the stored hash (`auth.service.ts:61-66`).

**Decision — why DB lookup on every request?** `jwt.strategy.ts:24-31` does a
`findUnique` on every authenticated request rather than trusting the token's
claims. Trade-off: it costs one indexed query per request, but it means deleted /
changed users are reflected immediately and you can revoke access by deleting the
row. For a portfolio app the freshness wins; at scale you'd cache this.

### 3.4 The OAuth "code exchange" dance (a subtle, interview-worthy design)

The naive OAuth implementation redirects the browser to
`FRONTEND_URL/callback?accessToken=...&refreshToken=...`. That **leaks tokens into
the URL** — they land in browser history, server logs, and the `Referer` header.

This project avoids that (`auth.controller.ts:96-100`, `auth.service.ts:68-85`):

```
GET /auth/google/callback
  → GoogleStrategy.validate() → handleOAuthUser() → issueTokens()
  → storeOAuthCode(tokens): generate random UUID, stash {tokens, expiresAt:+60s} in a Map
  → redirect to FRONTEND_URL/callback?code=<uuid>        ← only an opaque code in the URL
Frontend /callback page:
  → POST /auth/exchange-code { code }
  → exchangeOAuthCode(): look up + DELETE the entry, reject if missing/expired
  → returns { accessToken, refreshToken } in the JSON body  ← tokens never touch the URL
```

The code is **single-use** (deleted on read, `auth.service.ts:82`) and
**short-lived** (60s). This is a real security pattern (similar in spirit to OAuth
authorization codes) and a great thing to be able to explain.

**Decision — `handleOAuthUser` account-linking order** (`auth.service.ts:87-114`):
1. Find an `Account` by `(provider, providerAccountId)` → existing OAuth login.
2. Else find a `User` by email → link a new `Account` to it (so signing in with
   Google then GitHub on the same email doesn't create a duplicate user).
3. Else create a brand-new `User` + `Account`.

The `Account` table (separate from `User`) is the standard "one user, many linked
providers" model — the same shape NextAuth/Auth.js uses.

### 3.5 Jobs — ownership and the timeline

**Decision — every job operation is ownership-scoped.** `findOne(userId, jobId)`
(`jobs.service.ts:84-92`) queries `findFirst({ where: { id, userId } })`. If the
job belongs to someone else it is **indistinguishable from not existing** — both
return 404, no existence leak. `update`, `remove`, and `getEvents` all call
`findOne` first as a guard (`jobs.service.ts:95, 130, 136`). The user id always
comes from the verified token (`@CurrentUser()`), **never from the request body** —
that's the rule that prevents horizontal privilege escalation.

**Decision — the timeline is event-sourced-lite.** A `JobEvent` row is written
*in the same Prisma call* as the mutation, using Prisma's nested `create`:

- On job create: a `CREATED` event (`jobs.service.ts:28-30`).
- On a status change: a `STATUS_CHANGE` event capturing `fromStatus`/`toStatus`
  (`jobs.service.ts:116-124`), but **only if the status actually changed**
  (`statusChanged` guard at line 97).

Because the event is nested in the same write, the job and its history can't drift
out of sync — there's no separate "now also log an event" call that could fail
independently. The detail page renders these as a vertical timeline.

**Decision — stats computed in the DB, not in JS.** `getStats`
(`jobs.service.ts:143-173`) runs three queries in parallel with `Promise.all`:
a `groupBy(status)` for the per-status counts, a total `count`, and a "this month"
`count`. It then fills a zeroed `byStatus` object so every status key exists even
with zero jobs (so the frontend never sees `undefined`). `responseRate` =
(interviewing + offer + rejected) / total, rounded to one decimal. Pushing
aggregation into Postgres is the right instinct.

**Decision — CSV export is hand-rolled and injection-safe.** `exportCsv`
(`jobs.service.ts:175-232`) builds CSV manually. The `escape` helper wraps every
field in quotes and doubles internal quotes (`"` → `""`), which is correct CSV
escaping and also neutralizes the values. Capped at 10,000 rows. Returned with
`Content-Disposition: attachment` so the browser downloads it.

### 3.6 Error handling — one filter to rule them all

`PrismaExceptionFilter` (`common/filters/prisma-exception.filter.ts`) is a global
`@Catch()` (catch-all) filter:
- NestJS `HttpException`s (anything with `.getStatus()`) pass through unchanged —
  so `NotFoundException`, `ForbiddenException`, etc. keep their status/body.
- Prisma `P2002` (unique violation) → **409 Conflict**.
- Prisma `P2025` (record not found) → **404**.
- Everything else → logged with stack trace, returned as an opaque **500** (never
  leaks internal error details to the client).

The rule the code follows: **throw NestJS exceptions, never raw `Error`s** — a raw
error would fall through to the 500 branch.

### 3.7 Cross-cutting infrastructure

- **Config validation (`app.module.ts:15-30`)**: Joi schema fails *startup* if
  `DATABASE_URL`/`JWT_SECRET`/`JWT_REFRESH_SECRET` are missing or the secrets are
  under 32 chars. Fail-fast beats a runtime surprise.
- **Rate limiting**: a global 100/min `ThrottlerGuard`, with a tighter
  `@Throttle(10/min in prod)` on `register`/`login` to slow credential stuffing
  (`auth.controller.ts:30-48`).
- **Logging**: `nestjs-pino` with secret redaction — `authorization` header and
  all password/token body fields are scrubbed (`app.module.ts:39-45`). Pretty
  prints in dev, JSON in prod.
- **Swagger**: auto-generated API docs at `/api/docs`, dev-only (`main.ts:31-44`).
- **Health**: Terminus DB ping at `/health`, public, for uptime checks
  (`health/health.controller.ts`).

### 3.8 Company enrichment pipeline

When a job is created (or re-triggered via `POST /jobs/:id/enrich`), the app
asynchronously researches the company and surfaces structured intelligence on the
detail page. This is the most architecturally interesting feature. See
[ADR-001](../decisions/001-async-enrichment-queue.md) and
[ADR-002](../decisions/002-llm-tool-use-extraction.md) for the full decision rationale.

**The async pipeline:**

```
POST /jobs
  → JobsService.create() → job saved in DB
  → EnrichmentService.enqueueEnrichment(jobId)
      → CompanyProfile upserted with status=PENDING (synchronous — visible immediately)
      → BullMQ job added to 'company-enrichment' queue
  → 200 response returned to client

[BullMQ worker picks up the job]
  → EnrichmentProcessor.process()
      → CompanyProfile updated to PROCESSING
      → Promise.all([Brave Search × 2, website fetch])
      → LlmService.extract(company, context)  ← Anthropic Claude Haiku, tool_use
      → CompanyProfile updated to COMPLETED (or FAILED with sanitised error)

[Frontend]
  → refetchInterval: 3000 while status is PENDING or PROCESSING
  → stops polling once status settles
```

**Key design decisions in this flow:**

- **PENDING before the queue** — `enqueueEnrichment` upserts the `CompanyProfile`
  row *before* adding to BullMQ. If the queue is temporarily unavailable, the row
  exists in PENDING state; job creation still succeeds (try/catch in `JobsService`).

- **Cooldown guard** — `EnrichmentController.triggerEnrichment` (re-trigger endpoint)
  checks for an existing PENDING/PROCESSING profile and returns 409 Conflict if found.
  Prevents duplicate enrichment jobs.

- **SSRF mitigation** — `WebFetchService.isSafeUrl()` rejects requests to
  localhost, private IP ranges (10.x, 172.16–31.x, 192.168.x, 169.254.x), and
  non-HTTP protocols before any outbound call is made. The `job.url` field is
  user-supplied — always treat user-supplied URLs as untrusted.

- **Tool-use for guaranteed structure** — the Anthropic call uses
  `tool_choice: { type: 'any' }` to force a tool call. Combined with a JSON Schema
  on the tool definition, the response is always a typed object. A `sanitize()`
  function validates field types at runtime as defence-in-depth.

- **Error isolation** — if the FAILED status update itself throws (because the job
  was deleted while the worker was running), the processor catches and swallows the
  secondary error. The BullMQ job completes normally; no unhandled rejection.

- **Lean ownership checks** — `JobsService.findOwned()` (private) is used in write
  operations (`update`, `getEvents`). It selects only `{ id, status }` without
  `include: { companyProfile: true }`. The full `findOne` (with the JOIN) is only
  called for `GET /jobs/:id` where the enrichment data is actually needed.

### 3.9 Prisma 7 specifics (the "gotcha" knowledge)

- The `datasource db {}` block in `schema.prisma` has **no `url`** — Prisma 7
  removed it. The connection is wired at runtime through the **driver adapter**:
  `new PrismaPg({ connectionString: DATABASE_URL })` passed to `super({ adapter })`
  in `PrismaService` (`prisma.service.ts:10-15`). The CLI gets the URL from
  `prisma.config.ts` instead (`prisma.config.ts:11-13`).
- `PrismaService` implements `OnModuleInit`/`OnModuleDestroy` to `$connect` /
  `$disconnect` with the Nest lifecycle.
- Schema indexes are intentional: `@@index([userId])`, `@@index([userId, status])`,
  `@@index([userId, appliedAt])`, `@@index([userId, createdAt])` on `Job` — these
  match the exact filter/sort patterns in `findAll` and the dashboard "recent by
  createdAt" query. Indexing to the query shape is a senior signal.

---

## 4. Frontend architecture (Next.js 16)

### 4.1 Routing and the two route groups

```
app/
├── layout.tsx                 root: <Providers> + fonts + dark base
├── (auth)/                    route group — adds NO URL segment
│   ├── login/      → /login
│   ├── register/   → /register
│   └── callback/   → /callback     (OAuth landing)
└── (dashboard)/               route group — adds NO URL segment
    ├── layout.tsx             sidebar + header shell
    ├── page.tsx    → /         dashboard home
    ├── jobs/       → /jobs      list + kanban
    ├── jobs/[id]/  → /jobs/:id  detail + timeline
    └── profile/    → /profile
```

**Decision — route groups split layouts, not URLs.** `(auth)` and `(dashboard)`
are parenthesized, so they add no path segment but let each group have its own
layout: auth pages render bare/centered, dashboard pages get the sidebar shell
(`(dashboard)/layout.tsx`). `app/(auth)/login/page.tsx` is `/login`, **not**
`/auth/login` — a common point of confusion worth knowing.

**Decision — `proxy.ts`, not `middleware.ts`.** Next.js 16 renamed the middleware
convention to `proxy.ts` / `export function proxy()`. It runs on every non-static
request (see the `matcher`) and does **coarse** route protection by checking only
the *presence* of the `jt_authed` cookie (`proxy.ts:5-17`):
- no cookie + private path → redirect to `/login`
- cookie + public path (except `/callback`) → redirect to `/`

Crucially, the cookie holds only `1` — **no token**. It is a routing hint, not a
security boundary. Real enforcement is the backend `JwtAuthGuard`. If a user forged
`jt_authed=1`, they'd reach the UI but every API call would 401. This separation
(cheap client-side redirect vs. authoritative server-side auth) is the correct
mental model and a good thing to articulate.

### 4.2 The auth state — deliberately three layers

This trips people up, so be precise about it:

1. **`lib/auth.ts` — `tokenStorage`**: a thin `localStorage` wrapper for the real
   JWTs (`jt_access`, `jt_refresh`). Only the Axios interceptor reads these.
2. **`store/auth.store.ts` — Zustand (persisted as `jt-auth`)**: the `user` object
   + `isAuthenticated` for rendering. Its `setAuth` is the *single* sync point —
   it writes tokens to `tokenStorage`, sets the `jt_authed` routing cookie (7-day,
   `SameSite=Lax`, `Secure` on https), and updates React state
   (`auth.store.ts:24-29`).
3. **The `jt_authed` cookie**: the only thing `proxy.ts` (which runs server-side
   and can't read `localStorage`) can see.

So: **tokens live in `localStorage` (readable by JS, needed by Axios); a
non-sensitive presence cookie lives where the middleware can read it; React state
mirrors the user for rendering.** One action (`setAuth`) keeps all three in sync;
`logout` tears all three down.

### 4.3 The Axios instance — the most sophisticated piece of frontend code

`lib/api.ts` is where to slow down in an interview.

**Request interceptor (`api.ts:8-14`)**: attaches `Authorization: Bearer <access>`
from `tokenStorage`, *unless the caller already set the header*. That "unless"
matters: right after login the token isn't persisted yet, so login/register/callback
pass the token explicitly (`login/page.tsx:35-37`).

**Response interceptor — silent refresh with a queue (`api.ts:27-79`)**: this
solves the **thundering-herd refresh** problem. When several requests 401 at once:
1. The first 401 sets `isRefreshing = true` and POSTs `/auth/refresh`.
2. Concurrent 401s are parked in `failedQueue` as pending promises (`api.ts:35-42`).
3. On refresh success, `processQueue` resolves every parked promise with the new
   token and each retries (`api.ts:22-25, 66`). The original request retries too.
4. On failure (or no refresh token), it clears storage, expires the cookie, and
   hard-redirects to `/login` (`api.ts:69-74`).

Two guards prevent loops/leaks:
- `original._retry` ensures a request is retried at most once (`api.ts:31, 49`).
- `/auth/login` and `/auth/register` 401s **bypass refresh** and surface to the
  caller so the user sees "invalid credentials" instead of being redirected
  (`api.ts:45-47`).

This is genuinely the kind of code teams get wrong; being able to walk it line by
line is a differentiator.

### 4.4 Server state with TanStack Query

`components/providers.tsx` creates the `QueryClient` **inside `useState`** so it's
created once and not torn down on re-render (`providers.tsx:8-13`). Global defaults:
`staleTime: 60s`, `retry: 1`.

**Query-key convention** (the contract the whole app relies on):
- `['stats']` — dashboard cards + chart
- `['jobs', filters]` — paginated list (filters object is part of the key, so
  changing a filter is a new cache entry and an automatic refetch)
- `['job', id]` — single job
- `['job-events', id]` — that job's timeline
- `['profile']` — user profile

**Decision — invalidate by prefix.** Mutations call
`invalidateQueries({ queryKey: ['jobs'] })`, which prefix-matches *every* `['jobs',
…]` entry (list, kanban, dashboard-recent) at once. So one create/delete refreshes
all job views. Writes that change status also invalidate `['stats']` and
`['job-events', id]`.

**Decision — optimistic Kanban drag (`kanban-board.tsx:44-65`).** Dragging a card
calls `onMutate` to (a) cancel in-flight `['jobs']` fetches, (b) snapshot the
current cache, (c) immediately move the card in the cache so the UI feels instant.
`onError` rolls back to the snapshot and toasts; `onSettled` invalidates to
reconcile with the server. Textbook optimistic-update pattern.

### 4.5 Forms — React Hook Form + Zod

Schemas are defined inline per component and passed to `zodResolver`. `JobForm`
(`components/jobs/job-form.tsx`) is the reusable create-*and*-edit form: `isEdit =
!!job` decides POST vs PATCH (`job-form.tsx:49, 96-98`). A `useEffect` keyed on
`[open, job]` resets the form when the modal opens, so stale values from a previous
edit don't bleed in (`job-form.tsx:65-87`). Empty optional fields (`url`,
`nextInterviewAt`) are coerced to `undefined` before sending, because the backend
wants a valid value or nothing (`job-form.tsx:91-95`).

### 4.6 Presentation layer

A small, consistent design system in `components/ui/` (`Button` with
variant/size/loading, `Input` with label/error, `Modal` on Radix Dialog, `Badge`,
`Skeleton`, `Spinner`). `cn()` (`lib/utils.ts`) merges Tailwind classes with
`clsx` + `tailwind-merge` so conditional classes don't conflict. All status/priority
colors and labels live in one place (`types/index.ts`) as the single source of UI
truth. Dark mode is a `class` on `<html>` toggled by `ThemeToggle`, defaulting to
the OS preference.

---

## 5. Database schema (the data model to sketch)

```
User 1───∞ Job 1───∞ JobEvent
  │           │
  1           1
  │           │
  ∞           1
Account     CompanyProfile   (nullable; 1:1; onDelete:Cascade)
```

- **CompanyProfile**: 1:1 optional relation to `Job`. Has its own `EnrichmentStatus`
  enum (`PENDING → PROCESSING → COMPLETED | FAILED`). Stored in a separate model
  rather than columns on `Job` so the list endpoint never fetches enrichment data
  (no `include: { companyProfile: true }` in `findAll`). See
  [ADR-003](../decisions/003-company-profile-separate-model.md).

- **User**: `password` is *nullable* — OAuth-only users have no password. That one
  nullable column is what makes the "social login can't change password" guard
  (`users.service.ts:55-59`) necessary.
- **Job**: enums for `status` and `priority`; `appliedAt` and `nextInterviewAt`
  separate from `createdAt`/`updatedAt` (when you applied ≠ when the row was made).
- **JobEvent**: `fromStatus` nullable (a `CREATED` event has no "from"), `toStatus`
  required.
- **Cascades**: `onDelete: Cascade` on both FKs — deleting a user wipes their jobs
  and events in one statement. This is what makes account deletion
  (`users.service.ts:73-76`) a single `delete`.

---

## 6. Deployment topology (free-tier engineering)

```
            ┌──────────────┐
  Browser ──┤   Vercel     │  Next.js frontend (standalone output)
            └──────┬───────┘
                   │ HTTPS (NEXT_PUBLIC_API_URL)
                   ▼
            ┌──────────────┐  single VM (e.g. Oracle A1, Arm64)
            │    Caddy     │  :80/:443, auto Let's Encrypt TLS
            └──────┬───────┘
                   │ reverse_proxy backend:3001
                   ▼
            ┌──────────────┐
            │   NestJS     │  Docker container, non-root user
            └──────┬───────┘
                   │ DATABASE_URL (sslmode=require)
                   ▼
            ┌──────────────┐
            │  Neon (PG)   │  managed Postgres, free tier
            └──────────────┘
```

**Decisions worth explaining:**
- **No DB container** — Postgres is on Neon (managed), so the VM holds no
  stateful data and the compose file is simpler (`docker-compose.prod.yml` comment).
- **Caddy for TLS** — it auto-provisions and renews Let's Encrypt certs via HTTP-01,
  so there's no manual cert management (`Caddyfile`).
- **Multi-stage Docker build** (`Dockerfile.prod`) — a `builder` stage compiles and
  runs `prisma generate`; a slim `runner` stage copies only `dist/`, `node_modules`,
  and Prisma assets. Runs as a **non-root** user (uid 1001). On boot it runs
  `prisma migrate deploy` (which only *applies* pending migrations, never resets)
  then `node dist/main`.
- **Build on the VM** — the GitHub Actions deploy SSHes in and builds *there*,
  because the VM is Arm64 and building locally avoids cross-arch image problems
  (`.github/workflows/deploy.yml`). Auto-deploy is gated behind `workflow_dispatch`
  until the VM is provisioned; `concurrency` prevents overlapping deploys.

---

## 7. Testing

**Backend unit tests (Jest)** — 91 tests across 10 spec files. The enrichment
pipeline has the densest coverage:

| Suite | What it covers |
|---|---|
| `PrismaExceptionFilter` | P2002 → 409, P2025 → 404, passthrough, fallback |
| `UsersService` | profile read, password change, OAuth guard, delete cascade |
| `JobsService` | create + enrichment, stats math, CSV escaping, ownership checks, events limit |
| `EnrichmentController` | ownership + 409 cooldown guard |
| `EnrichmentProcessor` | full pipeline, FAILED path, URL-strip in error message, mid-flight deletion |
| `LlmService` | tool_use response, sanitize() null/mixed techStack |
| `SearchService` | Brave API call, missing key guard, filter no-description results |
| `WebFetchService` | HTML stripping, SSRF guard (8 blocked URLs), truncation |

Tests use `jest.fn()` mocks at the service boundary. ConfigService is mocked rather
than reading `process.env` directly.

**Frontend unit tests (Vitest + React Testing Library)** — 23 tests covering
`CompanyProfileCard` across all four enrichment states (absent, PENDING, PROCESSING,
FAILED, COMPLETED), including Refresh button, deduplication, and API call assertions.

**Backend e2e (`test/app.e2e-spec.ts`)** — a full happy-path journey
(register → login → me → refresh → create job → list/filter → stats → get →
update status → events → export → delete → logout) run against the **live dev
DB** with a unique timestamped email per run; `afterAll` deletes that user
(cascade cleans everything). It re-applies the same global pipe/guard/filter as
`main.ts` in `beforeAll`. Notably it asserts the *timeline* (two events:
`CREATED` then `STATUS_CHANGE` with correct from/to) — i.e. it tests the
event-logging behavior, not just CRUD.

**Frontend e2e** — Playwright specs (`e2e/`) for auth, dashboard, jobs, profile,
run against live servers.

---

## 8. How to read the rest of this review

- `02-code-review.md` — concrete deficiencies and improvement points, ranked by
  severity, each with file:line and a suggested fix.
- `03-interview-guide.md` — the trade-offs to volunteer, likely questions, and
  crisp answers, plus the "what I'd do next" roadmap that turns a portfolio project
  into a conversation.
