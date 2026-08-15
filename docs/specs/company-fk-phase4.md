# Spec: Drop CompanyProfile, Phase 4

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 4 of 4 (core merge — dedup/UX are separate follow-on features, not phases of this spec). Depends on phase 3 fully merged and verified in production (no reads of `CompanyProfile` remain) for at least one full deploy cycle before deleting.

## Objective

Remove `CompanyProfile` model, its migration-generated table, and all now-dead code: the model itself, the enrichment-copy branch in `jobs.service.ts` (lines 82-121, from commits `f99540c`/`502bb56`), and any enrichment processor logic that targets `CompanyProfile` specifically instead of `Company`.

Success: `grep -r CompanyProfile` across the repo returns zero matches; enrichment always writes to `Company`, never `CompanyProfile`.

## Tech Stack
Prisma schema migration (drop table), NestJS service cleanup.

## Commands
Same as phase 1. `prisma migrate dev --name drop_company_profile` (ask first — destructive, drops a table).

## Project Structure
Based on the 20-file grep hit list from this session — expect changes across:
```
backend/prisma/schema.prisma                              → remove CompanyProfile model
backend/src/modules/jobs/jobs.service.ts                   → remove enrichment-copy branch (lines 82-121)
backend/src/modules/jobs/dto/job-response.dto.ts           → remove companyProfile field
backend/src/modules/jobs/dto/company-profile-response.dto.ts → delete file
backend/src/modules/enrichment/enrichment.service.ts        → remove if CompanyProfile-specific, else n/a (may already be Company-only post phase 3)
backend/src/modules/enrichment/enrichment.processor.ts      → same
backend/src/modules/enrichment/enrichment.controller.ts     → same
frontend/types/index.ts, api.generated.ts                   → regenerate, remove type
```
This is the one phase likely to exceed 10 files given 20 files currently reference `CompanyProfile`/`companyProfile` (per repo grep this session). **Split into 2 PRs**: backend model+service removal first, frontend type cleanup + any remaining dead test fixtures second.

## Code Style
Deletion, not addition — no new patterns. Delete cleanly, don't leave commented-out code (per project convention: no `// removed` comments).

## Testing Strategy
Every test file in the 20-file list (`jobs.service.spec.ts`, `enrichment.*.spec.ts`, `company-profile-card.test.tsx`, `page.test.tsx`) needs its `CompanyProfile` fixtures/mocks removed or updated. Run full suite (`test:e2e` + frontend `npm run build`) after — this is the phase most likely to have a test silently asserting stale shape.

## Boundaries
- Always: confirm phase 3 has been live with zero `CompanyProfile` reads for a full deploy cycle before running this phase's migration — a table drop is not reversible without a backup restore.
- Ask first: the `prisma migrate dev` (destructive), and confirm before starting given it's the highest-risk phase.
- Never: run this phase's migration in the same PR/session as phase 3 — needs the soak period as a safety gap.

## Success Criteria
- [ ] Zero repo-wide matches for `CompanyProfile`/`companyProfile`
- [ ] Full backend + frontend test suite passes
- [ ] `npm run build` (frontend) passes — per CLAUDE.md, `tsc --noEmit` alone isn't sufficient
- [ ] Migration drops the `company_profiles` table cleanly
- [ ] Split across 2 PRs if file count requires it, each ≤10 files

## Open Questions
- Exact soak period before running the drop migration — one deploy cycle, one week, user's call at phase 3 completion time.
- Does `enrichment.service.ts`/`enrichment.processor.ts` still have `CompanyProfile`-specific logic after phase 3, or was that already fully swapped to `Company` in phase 3's cutover? Needs re-grep at phase 4 start, not assumed now — file list above is provisional.
