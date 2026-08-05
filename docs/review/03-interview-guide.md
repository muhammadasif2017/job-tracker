# Job Tracker — Interview Guide

> How to *talk about* this project. The architecture is in `01-architecture.md`;
> the honest gaps are in `02-code-review.md`. This file turns both into a
> conversation: a 60-second pitch, the trade-offs to volunteer, likely questions
> with crisp answers, and a "what I'd do next" roadmap.

---

## 1. The 60-second pitch

> "Job Tracker is a full-stack app for managing a job search through a hiring
> pipeline. The backend is a **NestJS + Prisma + Postgres** REST API with JWT
> access/refresh auth plus Google and GitHub OAuth. The frontend is **Next.js 16**
> with TanStack Query for server state, an Axios layer that does silent token
> refresh, and a Kanban board with optimistic drag-and-drop. Every job mutation
> writes an immutable timeline event in the same database call, so each application
> has an audit trail. It's containerized and deployed on a single VM behind Caddy
> for automatic TLS, with the database on Neon and the frontend on Vercel — all
> within free tiers. I built it to practice production patterns end-to-end:
> layered architecture, secure auth, and deploy/ops, not just CRUD."

Then stop and let them pick a thread.

---

## 2. The five things to make sure you can explain deeply

If you only master five areas, make them these — they're where the engineering is.

1. **The auth token model.** Two JWTs, different secrets, short access + long
   refresh, refresh token stored *bcrypt-hashed*, rotated on every use, logout nulls
   it. (`auth.service.ts:116-137`)
2. **The OAuth code-exchange.** Why redirecting tokens in the URL is unsafe, and how
   the one-time 60-second `code` → `POST /auth/exchange-code` pattern keeps tokens
   out of browser history/logs. (`auth.controller.ts:96-100`, `auth.service.ts:68-85`)
3. **The Axios silent-refresh queue.** How concurrent 401s are funneled into one
   refresh call with a `failedQueue`, the `_retry` loop guard, and why login/register
   bypass it. (`lib/api.ts`)
4. **Ownership scoping.** Every job op resolves through `findOne(userId, jobId)`, the
   user id comes from the verified token (never the body), and other users' jobs
   return 404 not 403. (`jobs.service.ts:84-92`)
5. **The global-guard, opt-out-public security default.** Routes are locked unless
   they say `@Public()`, so a forgotten annotation fails *safe*. (`main.ts:28`,
   `jwt-auth.guard.ts`)

---

## 3. Trade-offs to volunteer *before* they ask

Volunteering trade-offs reads as senior. Each of these is a "I chose X over Y
because…, and the cost is…" statement.

### Tokens in `localStorage` vs `httpOnly` cookies
> "I keep the JWTs in localStorage so the Axios layer can attach them and so refresh
> works cleanly across a cross-origin SPA→API split. The cost is XSS exposure: if an
> attacker runs script in my page they can read the tokens. I mitigate with short
> 15-minute access tokens and by keeping only a non-sensitive presence cookie
> (`jt_authed`) for routing — no token in the cookie. The more hardened design is
> httpOnly, SameSite cookies plus CSRF protection; I'd move to that if this held
> sensitive data."

### Stateless JWT vs DB lookup per request
> "My JWT strategy does revalidate against the DB on every request, which gives me
> instant revocation and fresh user data at the cost of one indexed query per call.
> A purely stateless design would skip that for throughput. For this scale I chose
> correctness; at higher load I'd cache the user or accept the staleness."

### Middleware presence-check vs real auth in middleware
> "The Next middleware only checks that a cookie exists — it's a cheap redirect, not
> the security boundary. The real check is the API's guard. I deliberately didn't
> validate JWTs in middleware because it can't do it cheaply and shouldn't be where
> security lives."

### Single VM + free tiers vs managed/scalable infra
> "It's deployed on one Arm VM with Caddy doing TLS, the DB on Neon, frontend on
> Vercel — chosen to stay free. The honest limitations: the OAuth code store and the
> single refresh-token column assume one process, so horizontal scaling needs Redis
> and a refresh-token table first. I know exactly what would have to change."

### No unit tests, e2e against a live DB
> "I prioritized an end-to-end test that exercises the real auth + timeline flow over
> unit coverage. The gap is that the trickiest pure logic — token rotation, the OAuth
> linking branches, the stats math, the refresh queue — isn't unit-tested. That's the
> first thing I'd add."

---

## 4. Likely questions and crisp answers

**Q: Walk me through what happens when a user logs in.**
> POST `/auth/login` → the `local` Passport strategy bcrypt-compares the password →
> `issueTokens` signs an access + refresh JWT, bcrypt-hashes the refresh token, stores
> the hash on the user, returns both. The frontend immediately calls `/auth/me` with
> the new access token to fetch the user, then `setAuth` writes tokens to localStorage,
> sets the routing cookie, and updates Zustand. The middleware now lets the user into
> the dashboard.

**Q: How do you keep a user from seeing another user's jobs?**
> Authorization is always keyed off the user id from the verified JWT, never anything
> in the request body. Every per-job service method calls `findOne(userId, jobId)`,
> which queries with both id and userId; a mismatch returns 404 — so you can't even
> probe which ids exist.

**Q: What's the timeline feature and how is it consistent?**
> Each job has `JobEvent` rows: a `CREATED` on insert and a `STATUS_CHANGE` whenever
> the status actually changes. They're written as a nested Prisma `create` inside the
> same statement as the job mutation, so the history can never drift from the job —
> there's no separate write that could fail on its own.

**Q: How does token refresh work on the client when several requests fail at once?**
> The first 401 flips an `isRefreshing` flag and fires one `/auth/refresh`. Any other
> 401s that arrive meanwhile are parked as promises in a queue. When refresh succeeds
> I resolve the whole queue with the new token and every request retries; if it fails I
> clear everything and redirect to login. A `_retry` flag stops a request from looping,
> and login/register failures skip refresh so the user sees the real error.

**Q: Why Prisma 7 specifically — anything different?**
> Prisma 7 moved to driver adapters, so the schema no longer carries the connection
> URL; I wire it at runtime with `PrismaPg` and the `DATABASE_URL`, and the CLI reads
> it from `prisma.config.ts`. I also have to run `prisma generate` after every
> migration for the client types to pick up new enums. I indexed `Job` on
> `(userId, status)` and `(userId, appliedAt)` to match my filter and sort patterns.

**Q: What would break if you put this behind a load balancer with three instances?**
> Two things, and I know exactly which: the OAuth `code` store is an in-process Map,
> so the exchange could hit the wrong instance — that needs Redis. And I store one
> refresh token per user, so rotation assumes one session; concurrent sessions need a
> refresh-token table. Everything else is stateless.

**Q: Where would you add caching?**
> The per-request user lookup in the JWT strategy is the obvious candidate — a short
> TTL cache keyed by user id. And `/jobs/stats` is a pure aggregation that could be
> cached and invalidated on job writes.

**Q: How do you handle errors consistently?**
> A single global exception filter. NestJS HTTP exceptions pass through with their
> status; Prisma unique/not-found codes map to 409/404; anything unexpected is logged
> with its stack and returned as an opaque 500 so internals never leak. The rule in the
> code is "throw NestJS exceptions, never raw Errors."

**Q: What's a bug you know about?**
> Be honest and pick one from `02-code-review.md` — e.g. *"On the profile page, the
> 'change password' form is hidden if you have any OAuth provider linked, which is
> wrong for someone who signed up with email and later linked Google. The real fix is
> to have the API return a `hasPassword` boolean instead of inferring it client-side."*
> Naming a real one builds credibility.

---

## 5. The whiteboard diagrams to practice

You should be able to draw these from memory:

1. **Request lifecycle** — helmet → CORS → throttler → JWT guard → validation pipe →
   controller → service → Prisma → exception filter. (`01-architecture.md §3.2`)
2. **OAuth code-exchange sequence** — browser ↔ provider ↔ backend ↔ frontend, with
   the one-time code. (`01-architecture.md §3.4`)
3. **Data model** — User 1‑∞ Job 1‑∞ JobEvent, User 1‑∞ Account, with the cascades.
4. **Deployment topology** — Vercel → Caddy/VM → Neon. (`01-architecture.md §6`)

---

## 6. "What would you do next?" — the roadmap answer

Have this ready; it shows you see the project as a starting point, not a finish line.
Ordered by value:

1. **Refresh-token table** (multi-device sessions + "log out everywhere"). — H1
2. **`hasPassword` from the API**; fix the profile gating. — H3 (quick, visible)
3. **Move the OAuth code store to Redis** so the API can scale horizontally. — H2
4. **Unit tests** for token rotation, OAuth linking, stats, CSV, and the refresh
   queue. — M3
5. **Email verification + password reset** — the obvious missing auth flows.
6. **API versioning / global `/api` prefix** before any breaking change. — L7
7. **Shared types** between front and back so the status enum has one source of
   truth. — L2
8. **Observability** — structured logs already exist (pino); add request-id
   correlation and a metrics endpoint.

---

## 7. One-line takeaways per layer (the cheat sheet)

| Layer | The one thing to remember |
| --- | --- |
| NestJS modules | Controller (HTTP) / Service (logic+DB) / DTO (validation) per feature. |
| Auth | Two JWTs, refresh hashed + rotated, locked-by-default routes. |
| OAuth | One-time code keeps tokens out of the URL. |
| Jobs | Ownership via `findOne(userId,id)`; 404 not 403; atomic timeline events. |
| Prisma 7 | URL wired at runtime via driver adapter; indexes match query shape. |
| Errors | One global filter; throw Nest exceptions, never raw Errors. |
| Next routing | `proxy.ts` presence-cookie redirect; route groups split layouts not URLs. |
| Client auth | tokenStorage (tokens) + Zustand (user) + jt_authed cookie (routing). |
| Axios | Single silent refresh with a queued retry of concurrent 401s. |
| Query layer | Keyed cache + prefix invalidation; optimistic Kanban drag. |
| Deploy | One VM + Caddy TLS, Neon DB, Vercel FE — free-tier, single-process. |
