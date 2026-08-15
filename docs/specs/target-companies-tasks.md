# Implementation Plan: Target Companies

Companion task breakdown for `docs/specs/target-companies.md`. Spec fully settled — all 9 assumptions confirmed, including parallel enrichment pipeline (not generalizing `EnrichmentProcessor`).

## Overview

Standalone `Company` model (target list, independent of `Job`), a parallel AI-enrichment pipeline reusing existing search/LLM services, dual-FK `Contact` (job OR company), soft-link auto-flag on job create, CSV bulk import, and the frontend surface for all of it.

## Architecture Decisions

- Schema, enrichment pipeline, and `Contact` dual-FK land in one migration/one PR-sized backend foundation before any endpoint work — everything else depends on it.
- Enrichment is a full parallel copy (new queue `company-target-enrichment`, new processor), not a branch inside the existing job pipeline — protects the tuned, working `EnrichmentProcessor` from regression.
- Job↔Company link stays soft (name-match only) for this whole plan — no `Job.companyId` FK task exists here; that's explicitly out of scope per the idea doc.

## Task List

### Phase 1: Foundation (schema)

- [ ] **Task 1: Prisma schema — Company, enums, Contact dual-FK**
  - **Description:** Add `CompanyCity` and `BusinessMode` enums, the `Company` model (personal fields + AI-fillable fields per spec's "Company Fields — Scope"), and change `Contact.jobId` to nullable + add nullable `Contact.companyId` + relation. One migration, not split — a single coherent schema change is safer than two migrations touching the same table twice.
  - **Acceptance:**
    - [ ] `schema.prisma` has `Company`, `CompanyCity`, `BusinessMode`; `Contact.jobId String?`, `Contact.companyId String?` + relation, both indexed.
    - [ ] Migration applies cleanly against the local dev DB.
  - **Verification:**
    - [ ] **Ask the user before running** `npx prisma migrate dev --name add_target_companies` (shared dev DB, per CLAUDE.md boundary).
    - [ ] `npx prisma generate` succeeds.
    - [ ] `npx tsc --noEmit` (backend) passes.
    - [ ] `npm run test:e2e` (backend) still green — regression check on the `Contact` FK change.
  - **Dependencies:** None.
  - **Files:** `backend/prisma/schema.prisma`, generated `backend/prisma/migrations/<ts>_add_target_companies/`.
  - **Scope:** S.

### Checkpoint: Foundation
- [ ] Migration applied, client regenerated, existing e2e suite still passes with the changed `Contact` model.
- [ ] Review with user before proceeding to endpoints.

---

### Phase 2: Companies module — read path

- [ ] **Task 2: Company create + list + get**
  - **Description:** New `companies` module. `ensureCompanyOwned(userId, companyId)` mirrors `ensureJobOwned`. `POST /companies`, `GET /companies` (filter by city/priority), `GET /companies/:id`.
  - **Acceptance:**
    - [ ] Company scoped to `userId`; cross-user access returns 404 (matches `Job`/`Contact` pattern).
    - [ ] `CreateCompanyDto` covers all "Personal" + "AI-fillable" fields from the spec, `T | null` on every optional field.
    - [ ] List endpoint filters by `city` and `priority` query params.
  - **Verification:**
    - [ ] `npx tsc --noEmit` (backend).
    - [ ] Manual: `POST /companies` then `GET /companies` via Swagger UI (`/api/docs`) returns the created row.
  - **Dependencies:** Task 1.
  - **Files:** `backend/src/modules/companies/companies.module.ts`, `companies.controller.ts`, `companies.service.ts`, `dto/create-company.dto.ts`, `dto/company-response.dto.ts`.
  - **Scope:** M.

- [ ] **Task 3: Company update + delete + module registration + tests**
  - **Description:** `PATCH /companies/:id`, `DELETE /companies/:id`. Register `CompaniesModule` in `AppModule`.
  - **Acceptance:**
    - [ ] `UpdateCompanyDto` (PartialType pattern, same as `UpdateContactDto`) accepts explicit `null` to clear a field.
    - [ ] Delete cascades to any linked `Contact` rows (Prisma `onDelete: Cascade` on `Contact.companyId`, set in Task 1).
    - [ ] Ownership check rejects cross-user update/delete with 404.
  - **Verification:**
    - [ ] `companies.service.spec.ts` — unit tests for CRUD + ownership rejection, mirrors `contacts.service.ts` test style.
    - [ ] `npm run test:e2e` (backend) passes with the module registered.
  - **Dependencies:** Task 2.
  - **Files:** `backend/src/modules/companies/companies.controller.ts`, `companies.service.ts`, `dto/update-company.dto.ts`, `companies.service.spec.ts`, `backend/src/app.module.ts`.
  - **Scope:** M.

### Checkpoint: Companies CRUD
- [ ] Full CRUD on `Company` works end-to-end via Swagger, ownership-enforced, tests green.

---

### Phase 3: Parallel enrichment pipeline

- [ ] **Task 4: Export shared services + CompanyEnrichmentModule scaffold**
  - **Description:** Add `SearchService`, `WebFetchService`, `LlmService` to `EnrichmentModule`'s `exports`. New `CompanyEnrichmentModule` importing `EnrichmentModule`, with `CompanyEnrichmentService.enqueueEnrichment(companyId)` — same upsert-status-then-queue.add shape as the existing `EnrichmentService.enqueueEnrichment`.
  - **Acceptance:**
    - [ ] `EnrichmentModule` exports the three services without changing their implementation.
    - [ ] `enqueueEnrichment(companyId)` sets `Company.status = PENDING` and enqueues onto a new `company-target-enrichment` BullMQ queue.
  - **Verification:**
    - [ ] `npx tsc --noEmit` (backend).
    - [ ] Nest app boots without DI errors (`npm run start:dev`, check for module resolution failures in the log).
  - **Dependencies:** Task 1 (needs `Company.status` column).
  - **Files:** `backend/src/modules/enrichment/enrichment.module.ts`, `backend/src/modules/companies/enrichment/company-enrichment.module.ts`, `company-enrichment.service.ts`.
  - **Scope:** S.

- [ ] **Task 5: CompanyEnrichmentProcessor + trigger endpoint**
  - **Description:** New processor mirroring `EnrichmentProcessor`'s structure (search → official-site fetch → LLM extract → confidence guard → write), but sourced from `Company.name`/`websiteUrl` instead of `Job.company`/`Job.url` (no job-posting-page fetch branch — companies have no posting URL). `POST /companies/:id/enrichment` on the controller, `@Throttle` same as `/jobs/parse` (external LLM/search cost).
  - **Acceptance:**
    - [ ] Triggering enrichment on a `Company` populates `industry`/`techStack`/`companySize`/`workPolicy`/`workLifeBalance`/`cultureSummary`/`headquarters`/`address`/`founded` fields, `status` moves `PENDING → PROCESSING → COMPLETED`/`FAILED`.
    - [ ] `Job`/`CompanyProfile` rows are untouched by this path — verified by inspecting logs/DB, not just code review.
    - [ ] Confidence-guard logic for `address`/`headquarters` reused with the same thresholds (0.7 / 0.25) as the job pipeline.
  - **Verification:**
    - [ ] `company-enrichment.processor.spec.ts` — happy path + failed-search path, reusing the mock patterns from `enrichment.processor.spec.ts`.
    - [ ] Manual: trigger enrichment on a real company name via Swagger, confirm fields populate within the BullMQ job's lifetime (check `npm run start:dev` logs for `enrichment_completed`-equivalent line).
  - **Dependencies:** Task 4.
  - **Files:** `backend/src/modules/companies/enrichment/company-enrichment.processor.ts`, `companies.controller.ts`, `company-enrichment.processor.spec.ts`, `backend/src/app.module.ts`.
  - **Scope:** M (logic-dense but contained — mirrors an existing, already-solved pattern).

### Checkpoint: Enrichment
- [ ] Company enrichment works end-to-end and existing job enrichment (`enrichment.processor.spec.ts`, full `test:e2e`) shows zero regression.

---

### Phase 4: Contact dual-FK

- [ ] **Task 6: Contacts service/controller/DTO — company branch**
  - **Description:** Generalize `ensureJobOwned` → `ensureOwner(userId, { jobId?, companyId? })` per the spec's Code Style snippet, on all four `ContactsService` methods. Reject (400) if both or neither of `jobId`/`companyId` are set on create.
  - **Acceptance:**
    - [ ] `POST /jobs/:jobId/contacts` still works unchanged (regression check).
    - [ ] New `POST /companies/:companyId/contacts` works the same way.
    - [ ] Sending both or neither FK → 400.
  - **Verification:**
    - [ ] `contacts.service.spec.ts` — extend with company-branch cases + the both/neither rejection case.
    - [ ] `npm run test:e2e` (backend).
  - **Dependencies:** Task 1, Task 3 (needs `ensureCompanyOwned` pattern already proven).
  - **Files:** `backend/src/modules/contacts/contacts.service.ts`, `contacts.controller.ts`, `dto/create-contact.dto.ts`, `contacts.service.spec.ts`.
  - **Scope:** M.

---

### Phase 5: Job auto-flag soft-link

- [ ] **Task 7: Name-match lookup on job create**
  - **Description:** In `JobsService.create`, after insert, case-insensitive lookup `Company` by `name` for that `userId`. Return `matchedCompany` (id + name only) alongside the created job — not persisted anywhere.
  - **Acceptance:**
    - [ ] Creating a `Job` with `company` matching an existing `Company.name` (case-insensitive) returns `matchedCompany` in the response.
    - [ ] No match → `matchedCompany: null`, no behavior change to existing job creation.
  - **Verification:**
    - [ ] Extend `jobs.service.spec.ts` with a match + no-match case.
    - [ ] `npm run test:e2e` (backend).
  - **Dependencies:** Task 1.
  - **Files:** `backend/src/modules/jobs/jobs.service.ts`, `backend/src/modules/jobs/dto/job-response.dto.ts` (or equivalent response shape), `jobs.service.spec.ts`.
  - **Scope:** S.

---

### Phase 6: CSV import

- [ ] **Task 8: CSV import endpoint**
  - **Description:** Hand-rolled parser (per spec Assumption 5) for `name,city,businessMode` columns. `POST /companies/import`, per-row validation, per-row error reporting (not all-or-nothing).
  - **Acceptance:**
    - [ ] Valid CSV creates one `Company` per row.
    - [ ] Malformed row (bad city/businessMode value, missing name) is skipped and reported by row number, doesn't abort the whole import.
    - [ ] Empty file → clear 400, not a silent no-op.
  - **Verification:**
    - [ ] `companies-import.service.spec.ts` — valid file, malformed row, empty file, duplicate-name row.
  - **Dependencies:** Task 3.
  - **Files:** `backend/src/modules/companies/companies-import.service.ts`, `companies.controller.ts`, `companies-import.service.spec.ts`.
  - **Scope:** S.

### Checkpoint: Backend complete
- [ ] Full `npm run test:e2e` (backend) green.
- [ ] `npx tsc --noEmit` clean.
- [ ] Review with user before starting frontend.

---

### Phase 7: Frontend

- [ ] **Task 9: Types + query hooks foundation**
  - **Description:** `Company`, `CompanyCity`, `BusinessMode` types + `CITY_LABELS`/`CITY_COLORS`/`BUSINESS_MODE_LABELS` (mirrors `STATUS_LABELS`/`STATUS_COLORS`). `useCompaniesQuery`, `useCreateCompanyMutation`, `useUpdateCompanyMutation`, `useDeleteCompanyMutation`, `useCompanyEnrichmentMutation` — same query-key/invalidation convention as `features/jobs/hooks.ts`.
  - **Acceptance:**
    - [ ] `['companies', filters]` query key convention followed.
    - [ ] Mutations invalidate `['companies']` on success.
  - **Verification:**
    - [ ] `npx tsc --noEmit` (frontend, via `npm run build` since that's the CLAUDE.md-mandated check).
  - **Dependencies:** Task 3, Task 5 (backend contracts must exist).
  - **Files:** `frontend/types/index.ts`, `frontend/features/companies/hooks.ts`.
  - **Scope:** S.

- [ ] **Task 10: Companies list page**
  - **Description:** New route + sidebar nav entry. Browse/filter by city/priority, `<Skeleton>` while loading (per CLAUDE.md convention, not a spinner).
  - **Acceptance:**
    - [ ] `/companies` route renders the list, filters work, appears in sidebar.
  - **Verification:**
    - [ ] `company-list.test.tsx` — Vitest, mirrors `job-form.test.tsx` conventions.
    - [ ] `npm run build` (frontend).
  - **Dependencies:** Task 9.
  - **Files:** `frontend/app/(dashboard)/companies/page.tsx`, `frontend/components/companies/company-list.tsx`, `frontend/components/layout/sidebar.tsx`, `company-list.test.tsx`.
  - **Scope:** M.

- [ ] **Task 11: Company form + enrichment trigger**
  - **Description:** RHF + Zod form (create/edit in one component, `isEdit = !!company`, same pattern as `job-form.tsx`). "Refresh enrichment" button with the confirm-dialog warning from spec Assumption 9 (manual corrections may be overwritten).
  - **Acceptance:**
    - [ ] Create and edit both work through the same component.
    - [ ] Enrichment trigger shows loading state, populates fields on completion (poll or refetch on `['company', id]`, same pattern as job's `companyProfile` poll).
    - [ ] Refresh on an already-enriched company shows the overwrite-warning confirm dialog before firing.
  - **Verification:**
    - [ ] `company-form.test.tsx`.
    - [ ] `npm run build` (frontend).
    - [ ] Manual: run dev servers, create a company, trigger enrichment, confirm fields populate.
  - **Dependencies:** Task 9.
  - **Files:** `frontend/components/companies/company-form.tsx`, `company-form.test.tsx`, `frontend/features/companies/hooks.ts`.
  - **Scope:** M.

- [ ] **Task 12: Company contacts + CSV import UI**
  - **Description:** Contact list/add/edit/delete scoped to a company (reuse/generalize existing job-contacts component if it's not job-specific-shaped, otherwise a parallel `company-contacts.tsx`). CSV import dialog — file picker, per-row result summary (success/error) after upload.
  - **Acceptance:**
    - [ ] HR contacts can be added/edited/removed on a company detail view.
    - [ ] CSV import shows per-row success/error, matches Task 8's backend response shape.
  - **Verification:**
    - [ ] `npm run build` (frontend).
    - [ ] Manual: import a small test CSV (2 valid rows, 1 malformed), confirm the per-row result matches.
  - **Dependencies:** Task 6, Task 8, Task 9.
  - **Files:** `frontend/components/companies/company-contacts.tsx`, `frontend/components/companies/csv-import-dialog.tsx`, `frontend/features/companies/hooks.ts`.
  - **Scope:** M.

- [ ] **Task 13: Job-form "already saved" banner**
  - **Description:** Dismissible, non-blocking banner on `job-form.tsx` using `matchedCompany` from the create response (Task 7).
  - **Acceptance:**
    - [ ] Creating a job whose company name matches a saved `Company` shows a dismissible banner linking to that company.
    - [ ] No match → no banner, no behavior change.
  - **Verification:**
    - [ ] `npm run build` (frontend).
    - [ ] Manual: create a `Company` named "Test Co", then create a `Job` with company `"test co"` (case variant) — banner should appear.
  - **Dependencies:** Task 7, Task 9.
  - **Files:** `frontend/components/jobs/job-form.tsx`, `frontend/features/jobs/hooks.ts`.
  - **Scope:** S.

### Checkpoint: Complete
- [ ] `npm run test:e2e` (backend) and `npm run build` (frontend) both pass.
- [ ] Manual golden-path walkthrough: add company → enrich → correct a field → add HR contact → import CSV → create matching job → see banner.
- [ ] All acceptance criteria across Tasks 1-13 met.
- [ ] Ready for `git-workflow-and-versioning` (commit breakdown) and PR.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Contact FK change (Task 1/6) regresses existing job-contacts flow | Med | Task 1 verification explicitly re-runs full `test:e2e` before any new endpoint work starts |
| Company enrichment processor duplicates job processor's tuned guard logic, drifts out of sync over time | Low | Both call the same underlying `LlmService`/`SearchService` — only the processor shell (which fields to read from, DB write target) differs; guard thresholds documented as "reused with same values" in Task 5 |
| Hand-rolled CSV parser breaks on a real-world export with quoted commas | Low | Spec Assumption 5 already flags this — escalate to `csv-parse` (ask first) if it happens, not a silent workaround |
| Enrichment refresh silently overwrites a manual correction | Med | Frontend confirm dialog (Task 11) — accepted tradeoff per spec Assumption 9, not solved at the data layer |

## Open Questions

None — spec and this breakdown are both fully settled.
