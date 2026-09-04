# ADR-032: Catalog of system design concepts in use

## Status
Accepted

## Date
2026-08-30

## Last updated
2026-09-02 — added the concepts below that were in the code but missing from
the original snapshot: append-only event log, index shape, Serializable
get-or-create, guard-in-the-write deletes, refresh-token hashing, idempotent
enqueue, CAS-claim-before-enqueue, edge auth guard, query invalidation graph,
Redis durability, verified DB TLS, readiness contract, trusted proxy hop.

## Context

The system-level diagrams in `docs/architecture.md` and the reasoning behind
individual choices scattered across 31 prior ADRs together describe a
consistent set of system design concepts (auth model, async processing,
storage abstraction, authorization scoping, etc.), but there was no single
place that named them as a catalog. Onboarding (human or agent) had to
reconstruct "what patterns does this codebase actually use" by reading the
diagrams and cross-referencing ADRs one at a time.

This ADR does not introduce a new decision — it records the decision to
maintain such a catalog, and captures the concepts as they stand today. Per
the README's "what isn't here" rule, it intentionally does not duplicate the
mermaid diagrams or full reasoning already in `docs/architecture.md` and the
ADRs it cites; it points to them instead.

## Decision

Maintain a running catalog of system design concepts, each with a one-line
description and a pointer to where it's decided/diagrammed in more depth.

### Backend architecture
- **Modular monolith, feature-module shape** — one NestJS module per
  domain (`controller` + `service` + `dto/`), not a layered
  MVC split. See `backend/CLAUDE.md`, `docs/architecture.md` (module map).
- **Ownership-scoped authorization instead of per-row `userId`** — child
  records of a `Job` (contacts, interview rounds) are authorized via
  `ensureJobOwned(userId, jobId)` against the parent, not a `userId` column
  on the child. ADR-015, ADR-022.
- **RBAC via a global, opt-in guard** — `RolesGuard` runs globally but
  no-ops unless a route carries `@Roles()`; `AdminService` intentionally
  breaks ownership scoping since admin-acting-on-another-user is the point.
  ADR-023.
- **Config validation at boot** — `ConfigModule` with Joi schema; the app
  fails fast on missing/malformed env vars rather than failing at first use.
- **Global rate limiting** — `ThrottlerGuard`, 100 req/60s, registered
  app-wide. `docs/architecture.md` (module map).
- **Guard-in-the-write instead of check-then-write** — ownership is folded
  into the mutating query's `where` (`deleteMany({ id, userId })`, then a
  `count === 0` → 404) rather than a separate existence check that can race
  the delete. `companies.service.ts` / `jobs.service.ts` (`remove`).
- **Single trusted proxy hop** — `trust proxy: 1`, production only, so
  `req.ip` is the real client for per-IP throttling while a client-supplied
  `X-Forwarded-For` entry stays untrusted. `backend/src/main.ts`.
- **Health endpoint as an explicit readiness contract** — Terminus checks
  Postgres and Redis; the DB ping timeout is raised to 5s specifically for
  Neon's idle-compute resume, and CI's boot gate is its one automated
  consumer. `modules/health/health.controller.ts`.

### Data model & persistence
- **Append-only event log for status history** — `JobEvent` records
  `fromStatus → toStatus` transitions; the paginated timeline, the funnel
  analytics and the LLM summariser all read that log instead of each
  reconstructing history from the mutable `Job` row.
  `backend/prisma/schema.prisma` (`JobEvent`).
- **Indexes shaped to the query, not to the column** — composites match the
  real filter+sort shape (`[userId, status]`, `[userId, appliedAt]`,
  `[jobId, createdAt]`), and because a composite's leading-column prefix
  already serves `WHERE a = ?`, a redundant single-column index on that
  leading column is dropped rather than kept alongside. See the comment on
  `JobEvent.@@index([jobId, createdAt])`.
- **Serializable get-or-create with bounded retry** — the case-insensitive
  find-or-create of a `Company` runs `findFirst` + `create` inside one
  `Serializable` transaction, treats P2002/P2034 as "the other side won",
  re-fetches, and retries up to 8 times before surfacing a 409 instead of an
  opaque 500. ADR-029, `jobs.service.ts` (`resolveCompanyId`).

### Auth
- **Dual JWT (access + hashed refresh) with reuse/theft detection** —
  refresh tokens are looked up by `jti` hash; a replayed (already-revoked)
  refresh token revokes every refresh token for that user. ADR-004,
  `docs/architecture.md` (auth sequence diagram).
- **OAuth code-exchange via a short-lived Redis code** — the OAuth
  callback never puts tokens in a redirect URL; it stores them server-side
  behind a 60s-TTL UUID that the SPA exchanges once. `docs/architecture.md`.
- **Register always returns 200** — prevents email enumeration.
  ADR "002-auth-register-returns-200".
- **Scoped personal access tokens** for the browser extension, separate
  from the session JWT lifecycle. ADR-028.
- **Refresh tokens persisted as SHA-256 hashes** — the row stores a hash of
  the token rather than the token itself, and deliberately not a bcrypt
  digest: bcrypt's 72-byte input limit truncated the JWT to its header plus
  the opening of its payload, which every token for the same user shares — so
  the stored hash bound nothing and any of that user's refresh tokens
  compared equal to any other. A slow KDF buys nothing here (no low-entropy
  secret to brute-force), so SHA-256 over the whole token plus a
  `timingSafeEqual` compare is the right shape. `auth.service.ts`.

### Async processing
- **BullMQ + Redis queues, one queue per domain** — `ENRICHMENT_QUEUE`
  and `NOTIFICATIONS_QUEUE` are kept separate so unrelated retry/backoff
  policies and failure semantics don't head-of-line-block each other.
  ADR-001 (async-enrichment-queue), ADR-019.
- **Cron-driven fan-out, not request-driven** — reminders/digests are
  produced by `ScheduleModule` cron jobs enqueuing into
  `NOTIFICATIONS_QUEUE`, deduplicated via stamped timestamps
  (`digestedAt` / `reminderSentAt`) rather than a separate "already sent"
  table. ADR-019.
- **Single source of truth for derived business logic across sync and
  async paths** — the notification digest reuses the exact same
  `getAttentionItems` helper the synchronous `GET /jobs/attention` endpoint
  uses, so the two can't drift. ADR-019.
- **Compare-and-swap for concurrent state transitions** — interview-round
  status sync uses transactional writes + CAS instead of naive
  read-then-write to close a race window. ADR-017, ADR-018.
- **Derived fields over redundant stored state** — `nextInterviewAt` is
  computed from `InterviewRound` rows inside the same transaction rather
  than being an independently-updated column that can drift. ADR-015.
- **Idempotent enqueue keyed by a stable queue job id** — timeline
  summarisation adds under `summarize-<jobId>`, so a burst of writes to one
  job (round added, outcome edited, status changed) coalesces into a single
  Groq call instead of one per write. `removeOnComplete`/`removeOnFail` are
  load-bearing here: they scope the coalescing to the burst, since BullMQ
  skips an `add` whenever a hash under that id still exists in *any* state.
  `timeline-summary.service.ts`.
- **CAS claim before enqueue** — `triggerEnrichment` flips the row's status
  to `PENDING` only if it isn't already `PENDING`/`PROCESSING` and treats
  `count === 0` as a 409, closing the TOCTOU window where two concurrent
  requests both read a non-busy status and both enqueue.
  `companies.service.ts`.

### Storage & external services
- **Driver abstraction behind an interface** — `IStorageService` with
  Local and Oracle Object Storage implementations selected by config; ADR
  "001-storage-driver".
- **Fail-open degradation for non-critical external deps** — `EmailService`
  logs and no-ops instead of throwing when `RESEND_API_KEY` is unset, so the
  app still boots in environments without it configured.
- **Cleanup-after-cascade ordering for external state** — storage keys are
  collected *before* a Postgres cascade delete and cleaned up *after* it
  commits, since object storage isn't part of the DB transaction. ADR-023.

### Frontend
- **Data-layer/UI separation** — TanStack Query hooks live in
  `features/*/hooks.ts`; route pages and components hold local UI state
  only, never fetch/query logic directly. `docs/architecture.md` (frontend
  structure), `frontend/CLAUDE.md`.
- **Contract-first FE/BE boundary** — API types are generated from the
  backend's OpenAPI spec rather than hand-maintained, so the two can't
  silently drift out of sync.
- **Edge auth guard before render** — the Next.js proxy redirects on the
  `jt_authed` / `jt_role` cookies, so a protected or admin-only route never
  renders a shell that then bounces the user. `frontend/proxy.ts`.
- **Invalidation graph, not per-key invalidation** — one job mutation
  invalidates every derived key it can affect (`jobs`, `stats`,
  `analytics.funnel`, `attention`); status changes apply an optimistic
  `onMutate`; dashboard queries hold `placeholderData: (prev) => prev` so a
  refetch doesn't blank the panel. `features/jobs/hooks.ts`.
- **Explicit null vs. undefined on update DTOs** — a PATCH payload must
  send `null` to clear a field; `undefined` means "leave alone" (Prisma
  semantics + `JSON.stringify` dropping `undefined` keys make this a real
  footgun otherwise). ADR-022.

### Deployment & infra
- **Split deploy targets** — frontend on Vercel, backend + Postgres +
  Redis co-located on a single VM via Docker Compose, decoupling frontend
  scaling/CDN concerns from backend infra. `docs/architecture.md`
  (deployment topology).
- **Reverse proxy for TLS termination** — Caddy in front of the backend
  container handles Let's Encrypt TLS, not the app itself.
- **Hardened CI/CD deploy pipeline** — ADR "008-deploy-pipeline-hardening".
- **Redis treated as durable state, not as a cache** — AOF with
  `appendfsync everysec` on a named volume, plus `maxmemory-policy
  noeviction`, because the queues are the system of record for pending work
  and an evicted or unpersisted job is work silently lost.
  `docker-compose.prod.yml`.
- **Verified TLS to the database** — the Neon connection string uses
  `sslmode=verify-full`, not `require`, so the certificate chain and
  hostname are actually checked rather than the connection merely being
  encrypted. `DEPLOY.md`.
- **E2E as a merge gate, not just a nightly check** — Playwright e2e runs
  path-filtered on PRs touching `frontend/**` or `backend/**`. ADR-025.

## Alternatives Considered

### Fold this into `docs/architecture.md` instead of a new ADR
Rejected: `architecture.md` is diagrams-first and describes *what* the
system looks like; this catalog is a flat, linkable index of *named
concepts* with one-line justifications, closer in spirit to an ADR than to
a system diagram. Keeping it separate also means it can carry a Status/Date
like any other decision record and be superseded independently if the
catalog is reorganized later.

### Fully duplicate each cited ADR's reasoning here
Rejected per the README's own rule against duplicating decisions that are
already documented elsewhere. This ADR is intentionally an index with
one-line descriptions, not a second copy of 15+ ADRs' worth of context.

## Consequences
- This ADR will drift as the system evolves; unlike most ADRs it isn't a
  point-in-time decision about one mechanism; it's a snapshot of many. It
  should be updated (not superseded) when a cataloged concept changes
  materially, and superseded only if the catalog itself is restructured.
- New system-design-level patterns introduced by future ADRs should get a
  one-line entry added here, so this stays a reliable index rather than a
  stale snapshot from 2026-08-30.
