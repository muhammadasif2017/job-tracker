# Implementation Plan: Job→Company FK, Phase 1

Spec: [company-fk-phase1.md](company-fk-phase1.md)

## Overview

Upgrade the existing find-only company lookup in `jobs.service.ts:59-80` to find-or-create, add a real `Job.companyId` FK, keep `CompanyProfile` dual-write unchanged. Auto-created `Company` rows use `CompanyCity.OTHER` (existing enum fallback, no schema change needed for city).

## Architecture Decisions

- **`CompanyCity.OTHER` for auto-created rows** — job-create never collects a city; `OTHER` already exists in the enum for exactly this "unknown" case. No schema change to `Company` needed.
- **`upsert` with empty `update: {}`** — matches the "find-only when it already exists" behavior from the spec; never overwrites an existing `Company`'s enrichment/user-edited fields from a job-create side effect.
- **`companyId` stays nullable this phase** — matches today's optional soft-link; required-ness and backfill are phase 3.

## Task List

### Phase A: Schema

- [ ] **Task 1: Add `Job.companyId` FK to schema**
  - **Description:** Add nullable `companyId String?` + `company Company? @relation(...)` to `Job`, inverse `jobs Job[]` on `Company`. Add index `@@index([companyId])`.
  - **Acceptance:** `schema.prisma` compiles; `prisma format` clean.
  - **Verification:** `npx prisma validate`
  - **Dependencies:** None
  - **Files:** `backend/prisma/schema.prisma`
  - **Scope:** XS

- [ ] **Task 2: Run migration — GATED, needs explicit user confirmation**
  - **Description:** `npx prisma migrate dev --name add_job_company_fk` against the shared dev DB. **Do not run without asking first** (CLAUDE.md boundary — shared dev DB, e2e tests run against it).
  - **Acceptance:** Migration applied, `prisma generate` run after (Prisma 7 requirement — see backend/CLAUDE.md).
  - **Verification:** `npx prisma studio` shows new column; `npx tsc --noEmit` passes with new Prisma client types.
  - **Dependencies:** Task 1, **user confirmation**
  - **Files:** `backend/prisma/migrations/<timestamp>_add_job_company_fk/`
  - **Scope:** XS (but high-risk — shared DB)

### Checkpoint: Schema
- [ ] Migration applied, Prisma client regenerated, `tsc --noEmit` clean
- [ ] **Stop and confirm with user before Task 2 specifically — everything else can be coded first with a stale-but-compiling schema assumption if useful, but do not run migrate without a go-ahead.**

### Phase B: Service logic

- [ ] **Task 3: Upgrade lookup to find-or-create in `jobs.service.ts`**
  - **Description:** Replace `findFirst` at lines 59-80 with `upsert` (`where: { userId_name: {...} }`, `create: { userId, name, city: CompanyCity.OTHER }`, `update: {}`, same `select` shape as today). Set `companyId: company?.id` on the `Job` — either via a second `update` right after `job.create`, or restructure to create the company first and pass `companyId` into the original `job.create` data (prefer this — one fewer write). Keep everything below (lines 82-129, the `CompanyProfile` dual-write and enrichment-enqueue branches) untouched, just reading from `company` instead of `matchedCompany` if the variable is renamed — or keep the name `matchedCompany` to minimize diff noise.
  - **Acceptance:**
    - [ ] Existing company name → `companyId` set, zero new `Company` rows, `CompanyProfile`/enrichment behavior byte-identical to today
    - [ ] New company name → new `Company` row (`city: OTHER`), `companyId` set, enrichment-enqueue branch runs (status is null, same as today's "no match" path)
    - [ ] Empty/whitespace company name → `companyId` null, no `Company` row (matches today)
  - **Verification:** `npm run test:e2e -- jobs.service` (or equivalent unit test command), `npx tsc --noEmit`
  - **Dependencies:** Task 2 (needs the Prisma client with `companyId`/`upsert` support)
  - **Files:** `backend/src/modules/jobs/jobs.service.ts`
  - **Scope:** S

- [ ] **Task 4: Unit tests for the 3 branches**
  - **Description:** Add/update tests in `jobs.service.spec.ts` for the three acceptance branches in Task 3, plus a concurrency edge case (two simultaneous job-creates with the same new company name — confirm `upsert` handles the race, not a `findFirst`+`create` pair which would double-create).
  - **Acceptance:** All 4 scenarios covered, existing tests still pass.
  - **Verification:** `npm test -- jobs.service.spec`
  - **Dependencies:** Task 3
  - **Files:** `backend/src/modules/jobs/jobs.service.spec.ts`
  - **Scope:** S

### Checkpoint: Service logic
- [ ] All unit tests pass, `tsc --noEmit` clean, no behavior change to `CompanyProfile`/enrichment paths (diff review confirms only the lookup block changed)

### Phase C: E2E coverage

- [ ] **Task 5: Extend e2e job-create assertions**
  - **Description:** Add a `companyId` presence check to the existing job-create e2e test in `test/app.e2e-spec.ts` (or wherever job-create e2e lives) — both for an existing and a new company name.
  - **Acceptance:** e2e passes against live dev DB.
  - **Verification:** `npm run test:e2e`
  - **Dependencies:** Task 3, Task 2 (needs live migrated DB)
  - **Files:** `backend/test/app.e2e-spec.ts`
  - **Scope:** XS

### Checkpoint: Complete
- [ ] Full backend test suite (`test:e2e`) passes
- [ ] `tsc --noEmit` clean
- [ ] PR file count ≤10 (currently tracking: schema.prisma, migration dir, jobs.service.ts, jobs.service.spec.ts, app.e2e-spec.ts — 5 files/dirs, well under cap)
- [ ] Ready for review with human before merge

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Migration against shared dev DB breaks other in-flight work | High | Gated Task 2, explicit confirmation required, not bundled with code changes |
| `upsert` race on concurrent job-creates with same new company name | Med | Task 4 explicitly tests concurrency; `upsert` (not findFirst+create) is race-safe by design at the DB level via the unique constraint |
| Diff noise from renaming `matchedCompany` → `company` | Low | Keep existing variable name in Task 3 to minimize unrelated diff |

## Open Questions
None blocking — `CompanyCity.OTHER` resolves the only open item from the spec (city default).
