# Spec: Redirect Job-Scoped Enrichment to Company, Phase 3b

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md). Inserted between phase 3 and phase 4 after phase 3's read cutover was reverted (see `company-fk-phase3.md` "Blocked" section) — this is what unblocks it.

## Objective

`JobsService.create()` still triggers the **job-scoped** enrichment pipeline (`EnrichmentService.enqueueEnrichment(jobId)` → `EnrichmentProcessor`), which writes results to `CompanyProfile` keyed by `jobId`. A **separate, near-duplicate** pipeline already exists for target companies — `CompanyEnrichmentService.enqueueEnrichment(companyId)` → `CompanyEnrichmentProcessor` — which writes to `Company` keyed by `companyId`, and is already race-safe (CAS-based conflict check in `CompaniesService.triggerEnrichment`, vs. the job-scoped controller's plain read-then-decide check with a real TOCTOU window).

Redirect job creation to trigger the **company-scoped** pipeline instead of the job-scoped one. This makes enrichment itself single-source-of-truth (one AI research run per company, not duplicated per job at that company), eliminates redundant Tavily/Groq spend, and is the prerequisite for phase 3's `findOne()` read cutover to actually show real data instead of permanently-`PENDING` companies.

Success: creating a job with a new/unenriched company triggers `CompanyEnrichmentService`, not `EnrichmentService`. The job-scoped pipeline (`EnrichmentModule`) becomes unused and is removed once verified.

## Tech Stack
NestJS, BullMQ, existing `CompanyEnrichmentProcessor`/`llm.service.ts`/`search.service.ts`/`web-fetch.service.ts` (shared services, no changes needed there).

## Commands
Same as phase 1.

## Recommended Direction

Retire the job-scoped pipeline, not duplicate-maintain both:

1. **`JobsService.create()`**: replace `this.enrichment.enqueueEnrichment(job.id)` with `this.companyEnrichment.enqueueEnrichment(company.id)` — only when `company` is non-null (a blank company name has nothing to enrich; today's code actually still enqueues job-scoped enrichment for a blank name, which is itself a minor existing bug this incidentally fixes). Skip entirely, don't enqueue, when `company` is null.
2. **Frontend `CompanyProfileCard`'s Refresh button**: change from `POST /jobs/${jobId}/enrichment` to `POST /companies/${companyId}/enrichment` — needs `companyId` passed down from the job (already present on every job response since phase 1, no backend change needed for this).
3. **Phase 3's read cutover, retried — must ship in the *same* PR as steps 1-2, not as a follow-up.** Originally planned as a separate PR (see the now-corrected note below), but that's wrong: if writes redirect to `Company` while `findOne()` still reads `CompanyProfile`, every new job's enrichment becomes invisible again — the exact bug that got reverted in phase 3, just from the opposite direction. `findOne()` reshapes `companyLink` into the `companyProfile` shape, but **falls back to the legacy `CompanyProfile` row when `companyLink.status` is null** (a pre-3b job whose Company was never enriched under the new pipeline) — this prevents already-completed research from the old job-scoped pipeline going dark for existing jobs until they're naturally re-enriched.
4. **Dead code removal**: `EnrichmentService`, `EnrichmentProcessor`, `EnrichmentController` (job-scoped) become unused once steps 1-2 ship and soak. **Not** the whole `EnrichmentModule` — it also provides `WebFetchService`/`SearchService`/`LlmService`, which `CompanyEnrichmentModule` depends on and must keep using. Remove in a follow-up PR after confirming zero remaining callers (`grep -r EnrichmentService`), leaving `EnrichmentModule` trimmed down to just the three shared services (rename it at that point if the "Enrichment" name now reads oddly for a module with no processor of its own — a judgment call for whoever does that cleanup). Don't bundle with steps 1-3.

## Project Structure
```
backend/src/modules/jobs/jobs.service.ts                          → create() enrichment call swap + findOne() read cutover (with fallback)
backend/src/modules/jobs/jobs.service.spec.ts                     → updated mocks/assertions
backend/src/modules/jobs/jobs.module.ts                           → imports CompanyEnrichmentModule alongside EnrichmentModule (JobParsingService still needs the latter's WebFetch/Search/Llm services directly)
frontend/components/company-profile-card.tsx                       → Refresh button target URL (falls back to job-scoped endpoint when no companyId) + companyId prop
frontend/app/(dashboard)/jobs/[id]/page.tsx                        → pass job.companyId to CompanyProfileCard
frontend/components/company-profile-card.test.tsx                  → updated mock endpoints (both company-scoped and fallback paths)
frontend/types/index.ts                                            → add Job.companyId
backend/test/app.e2e-spec.ts                                       → new polling test that waits for a real terminal enrichment state on the linked Company
frontend/e2e/company-enrichment.spec.ts                             → two tests hardcoded the old job-scoped enrichment endpoint (caught by CI, not by planning — see Implementation Notes)
frontend/e2e/fixtures.ts                                            → TestJob needs companyId for the above
```
11 files — over the 10-file cap by one. Justified: the two e2e-test files are a direct, inseparable consequence of the endpoint change (can't ship the redirect without fixing the tests that assert on the old endpoint) — splitting them into a follow-up PR would leave `main` red in between. Steps 1-3 ship together (see step 3's note above for why). Step 4 (dead code removal) is the only genuinely separate follow-up — it's pure deletion with no user-facing behavior change, safe to defer once steps 1-3 are observed working.

## Code Style
`CompanyEnrichmentService.enqueueEnrichment` already exists and is the pattern to call — no new service code needed for the enqueue itself. Verified no circular-import risk: `CompanyEnrichmentModule` (`backend/src/modules/companies/enrichment/company-enrichment.module.ts`) only imports `EnrichmentModule` (for the shared `WebFetchService`/`SearchService`/`LlmService`) and exports `CompanyEnrichmentService` — it doesn't import `CompaniesModule` itself. `JobsModule` can import `CompanyEnrichmentModule` directly (swap for its current `EnrichmentModule` import), one-directional, safe.

## Testing Strategy
- Unit: `jobs.service.spec.ts` — assert `CompanyEnrichmentService.enqueueEnrichment` is called with `company.id` (not `EnrichmentService.enqueueEnrichment` with `job.id`) on job create; assert it's *not* called when company is null (blank name).
- E2E: extend the existing job-create e2e test to wait for enrichment and assert the linked `Company` row reaches `COMPLETED`/`FAILED` (a real terminal state), not just that a `CompanyProfile` row exists — this is the exact gap that let phase 3's bug slip past the backend test suite (see phase3.md's postmortem). Mirror the frontend's `company-enrichment.spec.ts` pattern of waiting for a terminal state instead of asserting `status: expect.any(String)`.
- Manual: create a job for a brand-new company, confirm the Refresh button and populated fields appear in the UI (real end-to-end, not just API-level).

## Boundaries
- Always: keep the CAS-based conflict check from `CompaniesService.triggerEnrichment` — don't reintroduce the job-scoped controller's race-prone plain check anywhere. Ship the write redirect and read cutover together — never let them land in separate commits reachable independently on `main` (see step 3).
- Ask first: none beyond normal PR review — no schema/migration in this phase, `CompanyProfile` untouched.
- Never: bundle the dead-code removal (step 4) with the redirect+cutover (steps 1-3) in the same PR — the new pipeline must be observed working correctly first.

## Success Criteria
- [ ] `JobsService.create()` calls `CompanyEnrichmentService.enqueueEnrichment(company.id)`, not `EnrichmentService.enqueueEnrichment(job.id)`
- [ ] Blank company name → no enrichment call at all (was previously enqueuing job-scoped enrichment for an empty string)
- [ ] Frontend Refresh button hits `POST /companies/:companyId/enrichment`
- [ ] New e2e test actually waits for `COMPLETED`/`FAILED`, not just "a status field exists" — closes the exact gap phase 3 hit
- [ ] PR ≤10 files

## Resolution
- **Job-posting-URL context loss**: decided 2026-08-15 — accept it. `EnrichmentProcessor`'s job-posting-page fetch (`dbJob.url`) has no equivalent in `CompanyEnrichmentProcessor`, so a brand-new company (auto-created from job creation, no `websiteUrl`) loses that fallback context source. Not threading `jobPostingUrl` through for now — search-based fallback still works, and a user can manually set `websiteUrl` and hit Refresh if a specific company's research quality is poor. Revisit only if this turns out to matter in practice (e.g. a pattern of poor-quality auto-enrichment for cold-start companies).

## Open Questions
None remaining.

## Implementation Notes, 2026-08-15

Implemented as steps 1-3 in one PR (see "Recommended Direction" step 3 for why the original separate-PR plan was wrong — caught mid-implementation, before shipping, by reasoning through the intermediate state rather than by CI this time). Verified end-to-end: full backend unit suite, full backend e2e suite (including the new polling test that waits up to 45s for the linked `Company` to reach `COMPLETED`/`FAILED`), frontend unit tests for both the company-scoped and fallback Refresh paths, and both backend (`nest build`) and frontend (`next build`) production builds all clean. Step 4 (dead code removal) not done here — separate follow-up.

CI caught one more gap this time (not local testing, since backend and frontend e2e run in separate CI jobs and this session's local runs hadn't yet covered frontend e2e before the first push): `frontend/e2e/company-enrichment.spec.ts` had two tests hardcoding `POST /jobs/:id/enrichment` (mocking it, or expecting the CAS conflict check on it) — both needed updating to the new `/companies/:companyId/enrichment` endpoint. Fixed, then verified all 23 relevant frontend Playwright tests (`company-enrichment.spec.ts` + `companies.spec.ts`) locally against real dev servers before re-pushing.

## Step 4 (Dead Code Removal), 2026-08-15

Before removing anything: checked whether it was actually safe. `EnrichmentController`/`EnrichmentService` weren't fully dead — `company-profile-card.tsx`'s Refresh button still fell back to `POST /jobs/:id/enrichment` for any job with `companyId` null, and a read-only prod query showed **all 29 real production jobs** had `companyId` null (the phase-1 backfill script had never been run against prod). Ran it — dry-run first (clean: 29 jobs, all new companies, 0 conflicts), then applied with explicit confirmation. Verified after: 0 unlinked jobs remaining, 29 `Company` rows created.

With that done, the fallback became genuinely unreachable (a blank-company-name job never has a profile to show a Refresh button for either), so removed it too rather than leaving a latent 404 trap now that the backend route is gone. Deleted: `enrichment.service.ts`, `enrichment.processor.ts`, `enrichment.controller.ts` and their specs. Kept: `enrichment.module.ts`, trimmed to just export `WebFetchService`/`SearchService`/`LlmService` (still used by `CompanyEnrichmentModule` and `JobParsingService`). `RedisHealthIndicator`/`HealthModule` redirected from the deleted `ENRICHMENT_QUEUE` to `COMPANY_ENRICHMENT_QUEUE` (the only live queue) — it was only ever used for a Redis connectivity ping, not real enrichment logic.

11 files (6 deletions, 5 edits) — one over the cap again, same reasoning as before: a cohesive deletion, awkward to split without leaving `main` in a broken intermediate state. Verified: full backend unit suite (392 passing), full backend e2e suite (69 passing), full frontend unit suite (365 passing), both production builds clean.
