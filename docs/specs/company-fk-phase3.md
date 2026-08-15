# Spec: Backfill + Cutover Reads, Phase 3

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 3 of 4. Depends on phase 1 (FK exists) and phase 2 (per-job fields separated) merged.

## Objective

Backfill `companyId` on jobs created before phase 1, then switch every read path from `CompanyProfile` to `Company`. After this phase, `CompanyProfile` data is no longer read anywhere (still written, still exists — removed in phase 4). This is the risky phase: it changes what data users actually see.

Success: every job has a non-null `companyId` (or a documented, small "unmatched" set requiring manual resolution), and `company-profile-card.tsx` / job detail page render `Company` fields instead of `CompanyProfile` fields, with identical UI.

## Tech Stack
NestJS + Prisma migration script, Next.js frontend read paths.

## Commands
Same as phase 1. Backfill runs as a one-off script (`npx ts-node scripts/backfill-company-fk.ts` or a Prisma migration `--create-only` + manual SQL, whichever matches existing project convention — check `backend/prisma/migrations/` for prior data-backfill precedent before choosing).

## Project Structure
```
backend/prisma/schema.prisma                          → companyId non-null? (see Open Q)
backend/scripts/backfill-company-fk.ts (new)           → one-off backfill
backend/src/modules/jobs/jobs.service.ts               → findOne() include swap
backend/src/modules/jobs/dto/job-response.dto.ts        → response shape swap
frontend/components/company-profile-card.tsx            → read from job.company instead of job.companyProfile
frontend/app/(dashboard)/jobs/[id]/page.tsx              → pass-through update
frontend/features/jobs/hooks.ts                          → type update if response shape changes
frontend/types/index.ts / api.generated.ts               → regenerate types
```
~7-8 files — near the 10-file cap; if it overflows, split frontend cutover into its own follow-up PR after backend cutover.

## Code Style
Match `findOne()` at `jobs.service.ts:168-174` — swap the `include: { companyProfile: true, ... }` for `include: { companyLink: true, ... }` (or equivalent relation name), same shape.

## Testing Strategy
- Backfill script: dry-run mode first (log matches, no writes), then apply. Test against a copy/sample of dev data, not directly against shared dev DB blind.
- Unit: `jobs.service.spec.ts` `findOne` returns `Company` data, not `CompanyProfile`.
- E2E + `company-profile-card.test.tsx` / `page.test.tsx`: update fixtures to assert against `Company` shape.
- Manual: run app, open a job with pre-phase-1 data (backfilled) and a job created post-phase-1, confirm both render identically.

## Boundaries
- Always: run backfill dry-run and review output before the real run; keep `CompanyProfile` table itself untouched this phase (deletion is phase 4).
- Ask first: the backfill script run against the shared dev DB (per CLAUDE.md — this is exactly the kind of migration that needs a heads-up), and any `prisma migrate dev`.
- Never: silently drop jobs that fail to backfill — surface them (log + a documented list) rather than leaving `companyId` null with no visibility.

## Success Criteria
- [ ] Backfill script run with dry-run report reviewed before real execution
- [ ] % of jobs successfully backfilled reported; any unmatched jobs listed explicitly
- [ ] Job detail page + Companies section render identical data for a spot-checked sample of jobs (backfilled and new)
- [ ] `CompanyProfile` no longer read by any code path (grep confirms zero remaining reads, only writes)
- [ ] PR(s) ≤10 files each (split backend/frontend if needed)

## Resolution

Both original open items decided as recommended, 2026-08-15: `companyId` stays nullable (a blank-company-name job is a legitimate unlinked state, same as before phase 1). Backfill reuses phase 1's exact find-or-create logic (case-insensitive match, create with `city: OTHER` on a miss) — one code path, not two. `scripts/backfill-company-fk.ts` shipped and is safe/independent of the read cutover below — verified against seeded test data (matched-existing, new-company dedup within a batch, blank-name skip, idempotent re-run).

## Blocked: read cutover reverted, 2026-08-15

`JobsService.findOne()` was changed to read from `Company` (via `companyLink`) and reshape it into the `companyProfile` response shape, then **reverted** after CI caught a real bug the local test suite missed: the job-scoped enrichment pipeline (`EnrichmentService.enqueueEnrichment` → `EnrichmentProcessor`, `src/modules/enrichment/`) writes its results exclusively to `CompanyProfile`, keyed by `jobId` — never to `Company`. Cutting over reads without also moving those writes meant every newly created job's AI research became permanently invisible (stuck at "Queued…" forever); caught by `frontend/e2e/company-enrichment.spec.ts` on the PR's CI run, not by the backend unit/e2e suites (which only asserted `status: expect.any(String)`, true even for the stuck `PENDING` case — a real gap in this phase's own testing strategy above).

This means phase 3's "cutover reads" is not a read-only change — it requires the job-scoped enrichment write path to target `Company` (keyed by `companyId`) instead of `CompanyProfile` (keyed by `jobId`) first. That's a substantially bigger, separate piece of work: `EnrichmentProcessor` owns the actual Tavily/Groq extraction calls and the confidence-flag logic (`headquartersLowConfidence`/`addressLowConfidence`), and redirecting its writes needs its own spec, not a few-line addition here.

**Not doing in this PR.** `findOne()` stays on `CompanyProfile` for now. Only the backfill script ships from this phase.

## Open Questions
- New phase needed (call it phase 3b) to redirect `EnrichmentService`/`EnrichmentProcessor` writes from `CompanyProfile` (keyed by `jobId`) to `Company` (keyed by `companyId`) before the read cutover above can be safely retried. Needs its own spec — touches real LLM extraction logic, not just a model swap.
- Once 3b lands, re-attempt this phase's read cutover with a stronger test: an e2e assertion that actually waits for enrichment to reach `COMPLETED` and checks the Refresh button becomes visible, not just that `status` is *a* string.
