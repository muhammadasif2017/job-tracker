# Spec: Per-Job Company Override Fields, Phase 2

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 2 of 4. Depends on phase 1 (`Job.companyId` FK) merged.

## Objective

`Company.priority`/`personalNotes` are company-level today. User confirmed priority/notes are per-application (this specific role), not per-company. Give `Job` its own priority/notes fields distinct from `Company`'s, so merging the models in phase 4 doesn't collapse two different concepts into one column.

Success: `Job` has its own priority (already exists — `Job.priority` at schema.prisma:167) — confirm it's already per-job and only `personalNotes`-equivalent is missing. Add `Job.companyNotes` (or reuse existing `Job.notes`? — see Open Questions) as the per-application note field, kept separate from `Company.personalNotes` (which stays company-wide).

## Tech Stack

NestJS + Prisma 7, no frontend changes required if reusing `Job.notes` (already exposed); minor frontend label change only if a new field is added.

## Commands
Same as phase 1 (`build`, `test:e2e`, `tsc --noEmit`, `prisma migrate dev` — ask first).

## Project Structure
```
backend/prisma/schema.prisma          → new field if needed
backend/src/modules/jobs/dto/*.ts     → DTO update if new field
frontend/components/jobs/job-form.tsx → form field if new field exposed
```
~3 files if reusing `Job.notes`; ~5 if adding a new column.

## Code Style
No new pattern — follow existing `Job` field conventions (optional `String?`, no default).

## Testing Strategy
Unit: DTO validation accepts/omits the field per existing optional-field pattern (per CLAUDE.md: `T | null` on PATCH, explicit `null` clears). E2E: create/update job with the field, verify persisted value doesn't leak into/from `Company.personalNotes`.

## Boundaries
- Always: keep `Company.personalNotes` untouched — it's a separate, company-wide field.
- Ask first: schema change (new column) if `Job.notes` isn't reused.
- Never: merge this field into `Company` at any point — that's the entire point of this phase.

## Success Criteria
- [ ] Per-job note/priority path is fully separate from `Company`-level fields, confirmed by a test that edits both independently on the same company and shows no cross-contamination
- [ ] PR ≤10 files

## Open Questions
- **Is `Job.notes` (already exists) sufficient as the "per-job notes" field, or does the user want something distinct from general job notes (e.g. specifically "why this company, this role")?** If `Job.notes` already serves this purpose, phase 2 may need zero schema changes — just documentation that it's the confirmed per-job home. Recommend confirming with user before writing any migration.
- `Job.priority` already exists and is per-job — spec assumes no change needed there, only notes was the open item. Confirm.
