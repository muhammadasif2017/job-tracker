# Spec: Dedup/Merge Companies, Phase 5

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 5 — separate feature, not a step of the core FK merge (1-4). Depends on phase 4 complete (single `Company` model is now the only source, merge target is unambiguous).

## Objective

Let user merge two `Company` rows that are the same real company under different names (typo, "Google" vs "Google LLC"). Pick a canonical row, reassign all `Job`s pointing at the duplicate to the canonical row, delete the duplicate. One-pager's "Not Doing" already rules out auto-merge without confirmation — this is always a user-confirmed action.

Success: user can select two companies, merge them, and every job that pointed at the duplicate now points at the canonical company with zero data loss (jobs, not enrichment data — enrichment data resolution is itself an open question below).

## Tech Stack
NestJS transactional endpoint, Next.js confirmation UI.

## Commands
Same as phase 1.

## Project Structure
```
backend/src/modules/companies/companies.controller.ts   → POST /companies/:id/merge
backend/src/modules/companies/companies.service.ts       → merge transaction
backend/src/modules/companies/dto/merge-company.dto.ts (new)
frontend/features/companies/hooks.ts                     → useMergeCompanies mutation
frontend/components/companies/merge-company-dialog.tsx (new)
```
~5 files backend, ~3-4 frontend — split into 2 PRs (backend endpoint, frontend UI) to stay under cap, consistent with every other phase's split.

## Code Style
Merge as a single Prisma `$transaction`: reassign `Job.companyId` (`updateMany`), then delete the duplicate `Company` row. Same ownership-check pattern as everywhere else — verify both companies belong to `userId` before touching either.

## Testing Strategy
Unit: merge reassigns all jobs, duplicate row deleted, canonical row's own fields unchanged unless explicitly picked. E2E: merge two companies with jobs on each, confirm final state. Edge case: merging a company that has jobs with `personalNotes`/priority (phase 2 fields) — those stay on the `Job`, unaffected by the merge (this is exactly why phase 2 separated them).

## Boundaries
- Always: require explicit user confirmation naming both companies before merge executes — no silent/automatic merging, ever (one-pager "Not Doing").
- Ask first: none beyond normal PR review — this endpoint is destructive to one `Company` row but reversible in principle (user could recreate), lower risk than a migration.
- Never: merge companies across different users (enforce `userId` match on both sides — should be structurally impossible given `Company` is already scoped by `userId`, but assert it explicitly in the service, don't rely on the FK alone).

## Success Criteria
- [ ] Merge endpoint reassigns jobs + deletes duplicate in one transaction (no partial state on failure)
- [ ] Frontend requires explicit confirm step showing both companies' names before executing
- [ ] Cross-user merge attempt rejected (test explicitly)
- [ ] PRs ≤10 files each

## Open Questions — must resolve before implementation
- **Detection method**: manual "select two companies → merge" only, or auto-suggest near-duplicates? Two sub-options if auto-suggest: `websiteUrl` exact match, or fuzzy name match (e.g. Levenshtein/trigram). Recommend starting manual-only (simplest, matches "10x simpler" lens from idea-refine) — auto-suggest is its own follow-up once real duplicate data is observed.
- **Enrichment field conflict**: if both companies have `COMPLETED` enrichment with different values, which wins — canonical's existing data, or a user-driven field-by-field pick? Recommend: canonical wins by default (simplest), field-by-field picker is a nice-to-have, not MVP.
- Which company is "canonical" — always the one the user clicks first, or the one with more jobs / older `createdAt`? Recommend: user explicitly picks, don't infer.
