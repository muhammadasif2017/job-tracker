# Spec: Job→Company FK, Phase 1 (find-or-create + dual-write)

Parent idea: [docs/ideas/company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 1 of 4.

## Objective

Add a real `Job.companyId` FK to `Company`, replacing today's soft-link (name match at read time, no stored relation). Job create now **finds-or-creates** a `Company` row instead of only finding one. `CompanyProfile` keeps being written exactly as today (dual-write, no cutover of reads) — this phase is purely additive, sets up phase 3 (cutover) to be a read-path-only change.

Success: every newly created job has a `companyId` pointing at a real `Company` row, whether or not that company existed before. No existing behavior (enrichment copy, `CompanyProfile` creation, `matchedCompany` response field) changes.

## Tech Stack

NestJS + Prisma 7 (backend), no frontend changes this phase (FK is invisible to the UI until phase 3 cutover).

## Commands

```
Build:   npm run build           (backend/)
Test:    npm run test:e2e        (backend/, live dev DB)
Types:   npx tsc --noEmit        (backend/)
Migrate: npx prisma migrate dev --name add_job_company_fk   (ASK FIRST — shared dev DB)
```

## Project Structure

```
backend/prisma/schema.prisma                    → Job.companyId, Company relation
backend/src/modules/jobs/jobs.service.ts         → create() find-or-create logic
backend/src/modules/jobs/jobs.service.spec.ts    → unit tests for new branch
backend/test/app.e2e-spec.ts                     → e2e coverage if job-create assertions need updating
```
~4 files, within the 10-file PR cap from the parent idea doc.

## Code Style

Match existing `create()` shape at `jobs.service.ts:59-80` — same `select` narrowing, same try/catch-and-log-warn pattern for non-critical failures (company creation failing should not fail job creation, same philosophy as the existing enrichment-enqueue fallback at lines 108-121).

```ts
const company = dto.company.trim()
  ? await this.prisma.company.upsert({
      where: { userId_name: { userId, name: dto.company.trim() } },
      create: { userId, name: dto.company.trim(), city: /* existing default */ },
      update: {}, // find-only when it already exists — no field overwrite
      select: { id: true, /* ...same fields as today's matchedCompany select */ },
    })
  : null;
```

Note: `upsert` needs a `city` default since `Company.city` (`CompanyCity` enum) has no `@default` in the schema — check current value used elsewhere for a bare company-name creation (target-companies flow) and reuse the same default, don't invent a new one.

## Testing Strategy

Unit tests in `jobs.service.spec.ts`: (1) job create with a company name that already exists → `companyId` set, no new `Company` row created, existing `matchedCompany`/`CompanyProfile` behavior unchanged; (2) job create with a brand-new company name → new `Company` row created, `companyId` set, `status: null` (enrichment not triggered by this phase — same as today's "no match" branch); (3) job create with empty/whitespace company name → `companyId` stays null, no `Company` row created (matches today's `matchedCompany: null` path).

E2E: extend existing job-create e2e assertions to check `companyId` is present on the response/DB row when a company name is given.

## Boundaries

- **Always:** run `test:e2e` before commit (dev DB), keep `CompanyProfile` write path byte-for-byte unchanged this phase.
- **Ask first:** the `prisma migrate dev` itself (shared dev DB, per project CLAUDE.md) — confirm before running.
- **Never:** touch `CompanyProfile` read paths (job detail response, frontend company-profile component) — that's phase 3, out of scope here. Never make `companyId` required/non-null this phase — backfill for existing jobs is phase 3.

## Success Criteria

- [ ] `Job.companyId` (nullable) + relation added to schema, migration applied
- [ ] New job with existing company name → `companyId` set to that `Company`'s id, zero duplicate `Company` rows
- [ ] New job with new company name → new `Company` row created, `companyId` set
- [ ] `CompanyProfile` creation/enrichment-enqueue logic unchanged (same branches, same conditions)
- [ ] All existing `jobs.service.spec.ts` and e2e tests still pass
- [ ] PR stays ≤10 files

## Open Questions

- Default `Company.city` value for auto-created rows from job-create (vs. explicit target-company creation) — check `docs/specs/target-companies.md` or the target-companies create flow for the existing convention before writing the upsert.
- Should `Company` creation failure (e.g. `city` constraint issue) fall back silently like enrichment-enqueue does, or surface differently since it's now on the FK critical path? Recommend: same silent-fallback philosophy — job creation must still always succeed.
