# ADR-032: Catalog of system design concepts in use

## Status
Accepted

## Date
2026-08-30

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
