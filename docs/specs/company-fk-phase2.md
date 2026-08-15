# Spec: Per-Job Company Override Fields, Phase 2 — RESOLVED, NO-OP

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 2 of 4. Depends on phase 1 (`Job.companyId` FK), merged in #176.

## Resolution

Both open items confirmed by user, 2026-08-15: `Job.priority` (already exists, `schema.prisma:167`) is already per-job — no change needed. `Job.notes` (already exists) is confirmed as the per-job "why this company/role" field — reused as-is, not replaced by a dedicated column.

**No schema, service, or frontend changes required.** `Company.priority`/`Company.personalNotes` stay company-wide; `Job.priority`/`Job.notes` stay per-application. The two were already correctly separated before this phase — this doc exists only to record that the separation was checked and confirmed, ahead of phase 4's model merge (so the merge doesn't accidentally collapse them into one field).

## Objective (original)

`Company.priority`/`personalNotes` are company-level today. User confirmed priority/notes are per-application (this specific role), not per-company. Give `Job` its own priority/notes fields distinct from `Company`'s, so merging the models in phase 4 doesn't collapse two different concepts into one column.

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
None remaining — see Resolution above.
