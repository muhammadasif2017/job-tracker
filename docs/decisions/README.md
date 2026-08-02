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
