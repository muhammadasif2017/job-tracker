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

## Resolution, 2026-08-16

All three decided — bigger scope than the spec's own recommendations:

- **Detection method: auto-suggest near-duplicates.** Not manual-only. Still needs a concrete matching rule — likely `websiteUrl` exact match plus fuzzy name match (trigram/Levenshtein) — to be pinned down in planning, since Postgres trigram similarity (`pg_trgm`) vs. an in-app string-distance check is itself a real implementation choice (extension install vs. no-dependency JS).
- **Enrichment field conflict: field-by-field picker.** Not canonical-wins. When both companies have differing `COMPLETED` (or any non-null) values for the same field, the user picks per field which value survives on the merged row. This is real UI work — a diff-style comparison view, not just a confirm dialog.
- **Canonical selection: user explicitly picks.** Confirmed as recommended — no inference.

## Scope Impact

This changes the file/phase estimate substantially. The original ~5-backend/~3-4-frontend, 2-PR estimate assumed manual-only detection and canonical-wins conflict resolution — both no longer hold. Needs re-planning as more sub-phases, likely:
- 5a: canonical-pick + jobs-reassignment merge endpoint and dialog (the core transactional merge, manual trigger only — build this first, it's needed regardless of how duplicates get detected)
- 5b: field-by-field conflict picker UI (extends 5a's dialog once a real conflict case exists to design against)
- 5c: auto-suggest detection (backend matching logic + surfacing suggestions in the Companies list UI) — the most open-ended piece, needs its own matching-rule decision before scoping

Re-plan file counts per sub-phase before starting implementation, same discipline as phases 1-4.
