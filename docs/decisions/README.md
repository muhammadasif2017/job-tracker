# Architecture Decision Records

Significant technical decisions for the Job Tracker project. Each ADR captures
the context, the decision made, alternatives that were rejected, and consequences.

Read these alongside `docs/review/01-architecture.md` for the full picture.

| ADR | Title | Status |
|-----|-------|--------|
| [001](./001-async-enrichment-queue.md) | Async company enrichment with BullMQ + Redis | Accepted |
| [002](./002-llm-tool-use-extraction.md) | Anthropic Claude with tool_use for structured extraction | Superseded by ADR-007 |
| [003](./003-company-profile-separate-model.md) | CompanyProfile as a separate 1:1 model | Accepted |
| [004](./004-dual-jwt-auth.md) | Dual JWT (access + refresh) with hashed refresh storage | Accepted |
| [005](./001-storage-driver.md) | Dual-driver storage (local + Oracle Object Storage) for resume files | Accepted |
| [006](./006-google-oauth-disabled.md) | Google OAuth disabled for initial release | Accepted |
| [007](./007-groq-llm-migration.md) | Migrate LLM extraction from Anthropic Claude to Groq | Accepted |
| [008](./001-search-provider-tavily.md) | Use Tavily as the web search provider for company enrichment | Accepted |
| [009](./002-auth-register-returns-200.md) | POST /auth/register returns 200 to prevent email enumeration | Accepted |
| [010](./008-deploy-pipeline-hardening.md) | Harden the GitHub Actions deploy pipeline | Accepted |
| [011](./011-enrichment-search-disambiguation.md) | Disambiguate company enrichment search by domain and location | Partially superseded by ADR-013 |
| [012](./012-dev-only-docker-compose.md) | Separate docker-compose.dev.yml for local infra only | Accepted |
| [013](./013-enrichment-address-trust-guard.md) | Layered trust model + deterministic guard for enrichment address | Accepted |
| [014](./014-audit-hardening-fixes.md) | Hardening fixes from a graph-guided audit (refresh-token race, stale resume key, CSV injection, cuid param validation) | Accepted |
| [015](./015-interview-rounds-derived-next-interview.md) | InterviewRound as a separate 1:many model; nextInterviewAt becomes a derived field | Accepted |
| [016](./016-interview-rounds-no-outcome-gating.md) | Interview rounds are an ungated log — no restriction after a FAILED/CANCELLED round | Accepted |
| [017](./017-interview-round-status-sync.md) | Scheduling an interview round auto-promotes APPLIED → INTERVIEWING, and every round logs a Timeline entry | Accepted |
| [018](./018-interview-round-status-sync-race-fixes.md) | Race-condition fixes for interview-round status sync (transactional writes, CAS promotion, CAS on manual status update) | Accepted |
| [019](./019-notifications-module-design.md) | Notifications module — separate BullMQ queue, cron-driven reminders/digests, dedup via stamped timestamps | Accepted |
| [020](./020-split-job-source-discovery-channel.md) | Split JobSource into DiscoverySource and ApplicationChannel enums | Accepted |
| [021](./021-interview-round-ics-export.md) | ICS export for interview rounds — server-generated, no library | Accepted |
| [022](./022-contact-tracking-model.md) | Per-job contact/recruiter tracking as a single Contact model | Accepted |
| [023](./023-admin-rbac.md) | Role-based admin panel — global RolesGuard, self-delete block, shared deletion path | Accepted |
| [024](./024-per-user-timezone.md) | Per-user timezone for reminder/digest emails — supersedes SPEC.md's "out of scope v1" | Accepted |
| [025](./025-e2e-gates-pr-merges.md) | Run Playwright e2e on PRs (path-filtered), not just nightly | Accepted |
| [026](./026-e2e-locator-disambiguation.md) | Disambiguate Playwright locators with exact text and accessible names | Accepted |
| [027](./027-frontend-edge-case-handling.md) | Frontend failure/edge-case handling — error boundaries, isError states, request timeouts, error normalization | Accepted |
| [028](./028-personal-access-tokens.md) | Scoped personal access tokens for the browser extension | Accepted |
| [029](./029-company-fk-integrity-and-enrichment-card-unification.md) | Company/job FK integrity fixes, merge race, CSV import cap, and shared enrichment card | Accepted |
| [030](./030-job-edit-company-label-resend-guard.md) | Guard unrelated job edits from re-resolving a resent company label; stop overwriting the company-detail cache with a partial PATCH response | Accepted |
| [031](./031-enrichment-failure-classification.md) | Company enrichment failure classification — surface account-level errors, collapse everything else to two user-facing states | Accepted |
| [032](./032-system-design-concepts-catalog.md) | Catalog of system design concepts in use | Accepted |
| [033](./033-jobs-analytics-correctness-and-search-indexing.md) | Date the application not the save; measure stages by status changes; DB-enforced company uniqueness and trigram search | Accepted |
| [034](./034-appliedat-is-a-civil-date.md) | `Job.appliedAt` holds a civil date, not an instant — one calendar for the column, decided at write time | Accepted |
| [035](./035-enrichment-search-quota-conservation.md) | Enrich a company once, not once per job; don't retry an out-of-quota search | Accepted |
| [036](./036-same-name-guard-scoped-per-snippet.md) | Judge same-name search snippets individually; one impostor must not discard the whole extraction | Accepted |
| [037](./037-web-fetch-follows-validated-redirects.md) | Follow redirects with per-hop SSRF revalidation — failing closed on every 3xx broke official-site fetches | Accepted |
| [038](./038-enrichment-context-budget.md) | Drop contact-page fetches, put the homepage first, and raise the 6000/3500 context caps | Accepted |
| [039](./039-web-fetch-strips-site-chrome.md) | Strip nav/header/footer/aside/form and prefer <main> - menu text was outcompeting page content | Accepted |
| [040](./040-work-policy-from-linked-jobs.md) | Derive workPolicy from linked jobs' jobType - careers pages carry no policy wording | Superseded by 041 |
| [041](./041-company-profile-drops-work-policy.md) | Drop Company.workPolicy (it belongs to Job.jobType); enrich productDescription and businessMode instead | Accepted |
| [042](./042-techstack-noise-and-tracked-roles.md) | Keep site-scanner output out of techStack; feed tracked job titles in as first-party tech signal | Accepted |
| [043](./043-interview-rounds-carry-a-time-and-a-length.md) | `InterviewRound.scheduledAt` is a real instant resolved in the browser (`HasUtcOffset` rejects offset-less times); every round carries a user-supplied `durationMinutes` | Accepted |
| [044](./044-nestjs-12-forces-node-24-for-tests.md) | Move all `@nestjs/*` to 12 in one step; ESM-only core forces Node 24 and `--experimental-vm-modules` in every backend `jest` script | Accepted |
| [045](./045-idempotency-key-on-job-create.md) | `POST /jobs` takes an optional Idempotency-Key: Redis `SET NX` claim, 24h replay, 409 in flight, 422 on a changed body, fail-open | Accepted |
| [046](./046-queue-adds-fail-fast-on-redis-outage.md) | Queue adds fail fast on a Redis outage (`enableOfflineQueue: false`); workers keep a waiting connection via `withWorkerConnection` | Accepted |
| [047](./047-api-versioning-under-v1.md) | Serve every route at `/v1` plus an unversioned alias; `/health` and OAuth stay neutral; refresh cookie is scoped to the auth path of the surface the request used | Accepted |
| [048](./048-circuit-breaker-around-groq.md) | A hand-rolled circuit breaker wraps every Groq call: 3 consecutive outages (no status, 429, 5xx) open it for 30s, then one trial call | Accepted |
| [049](./049-correlation-ids.md) | `X-Request-Id` in, out and on every log line; carried into BullMQ jobs through AsyncLocalStorage and job data | Accepted |
| [050](./050-sentry-error-tracking-backend.md) | Sentry for unexpected 5xx (not 503) and final job failures, tagged with `requestId`; cookies, headers and bodies never collected | Accepted |
| [051](./051-sentry-error-tracking-frontend.md) | Sentry in the browser (lean `@sentry/browser`, errors only) and on the server; tunnelled through `/monitoring`; no personal data or IP | Accepted |
| [052](./052-prometheus-metrics-grafana-alloy.md) | Prometheus metrics on a private port (HTTP, queues, circuit, process), scraped by Grafana Alloy and pushed to Grafana Cloud | Accepted |
| [053](./053-sentry-logs.md) | Warn/error pino lines to Sentry Logs through `pinoIntegration`, cut to an allowlist of fields; never as error events | Accepted |

## How to read an ADR

- **Context** — why the decision had to be made; what constraints were in play.
- **Decision** — what was chosen and the key reasoning.
- **Alternatives Considered** — what else was evaluated and why it was rejected.
- **Consequences** — what the decision enables, prevents, or requires.

ADRs are never deleted. If a decision is reversed, a new ADR is written that
supersedes the old one.

## What isn't here

Decisions that are already documented in CLAUDE.md or the architecture overview
(e.g. "why PostgreSQL over MongoDB", "why NestJS over Express") are not duplicated
here. ADRs focus on the non-obvious decisions — the ones where the trade-offs
aren't immediately visible from the code.
