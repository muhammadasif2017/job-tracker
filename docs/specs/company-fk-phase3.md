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

Both open items decided as recommended, 2026-08-15: `companyId` stays nullable (a blank-company-name job is a legitimate unlinked state, same as before phase 1). Backfill reuses phase 1's exact find-or-create logic (case-insensitive match, create with `city: OTHER` on a miss) — one code path, not two.

Implemented as: `JobsService.findOne()` now includes `companyLink` and reshapes it into the same `companyProfile` response shape the frontend already expects (status defaults to `PENDING` when the linked `Company` has never been enriched) — **no frontend changes needed**, `company-profile-card.tsx` reads an identical shape regardless of source. `scripts/backfill-company-fk.ts` backfills pre-phase-1 jobs (dry-run by default, `--apply` to write); verified against seeded test data (matched-existing, new-company dedup within a batch, blank-name skip, idempotent re-run) since the dev DB currently has no real pre-phase-1 jobs to backfill. `CompanyProfile` itself is untouched — still written by the enrichment flow, still exists — removal is phase 4.

## Open Questions
None remaining.
