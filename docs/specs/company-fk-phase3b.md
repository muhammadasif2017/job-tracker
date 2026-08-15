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
3. **Phase 3's read cutover retried**: once writes land on `Company`, `JobsService.findOne()` can safely re-attempt the `companyLink` reshape from phase 3 (the code for this already exists in that PR's revert diff — recoverable from git history at `32bfc1c`'s parent, or straightforward to re-write).
4. **Dead code removal**: `EnrichmentService`, `EnrichmentProcessor`, `EnrichmentController` (job-scoped) become unused once steps 1-2 ship and soak. **Not** the whole `EnrichmentModule` — it also provides `WebFetchService`/`SearchService`/`LlmService`, which `CompanyEnrichmentModule` depends on and must keep using. Remove in a follow-up PR after confirming zero remaining callers (`grep -r EnrichmentService`), leaving `EnrichmentModule` trimmed down to just the three shared services (rename it at that point if the "Enrichment" name now reads oddly for a module with no processor of its own — a judgment call for whoever does that cleanup). Don't bundle with steps 1-3.

## Project Structure
```
backend/src/modules/jobs/jobs.service.ts                          → create() enrichment call swap
backend/src/modules/jobs/jobs.service.spec.ts                     → updated mocks/assertions
backend/src/modules/jobs/jobs.module.ts                           → import CompanyEnrichmentModule (or export its service) instead of / alongside EnrichmentModule
frontend/components/company-profile-card.tsx                       → Refresh button target URL + needs companyId prop
frontend/app/(dashboard)/jobs/[id]/page.tsx                        → pass job.companyId to CompanyProfileCard
frontend/components/company-profile-card.test.tsx                  → updated mock endpoint
backend/test/app.e2e-spec.ts                                       → update enrichment e2e assertions to check Company, not CompanyProfile
```
~7 files for steps 1-2, under the 10-file cap. Step 3 (read cutover retry) and step 4 (dead code removal) are separate follow-up PRs, not bundled here — same reasoning as the original phase 1-4 split: each is independently revertable and independently risky.

## Code Style
`CompanyEnrichmentService.enqueueEnrichment` already exists and is the pattern to call — no new service code needed for the enqueue itself. Verified no circular-import risk: `CompanyEnrichmentModule` (`backend/src/modules/companies/enrichment/company-enrichment.module.ts`) only imports `EnrichmentModule` (for the shared `WebFetchService`/`SearchService`/`LlmService`) and exports `CompanyEnrichmentService` — it doesn't import `CompaniesModule` itself. `JobsModule` can import `CompanyEnrichmentModule` directly (swap for its current `EnrichmentModule` import), one-directional, safe.

## Testing Strategy
- Unit: `jobs.service.spec.ts` — assert `CompanyEnrichmentService.enqueueEnrichment` is called with `company.id` (not `EnrichmentService.enqueueEnrichment` with `job.id`) on job create; assert it's *not* called when company is null (blank name).
- E2E: extend the existing job-create e2e test to wait for enrichment and assert the linked `Company` row reaches `COMPLETED`/`FAILED` (a real terminal state), not just that a `CompanyProfile` row exists — this is the exact gap that let phase 3's bug slip past the backend test suite (see phase3.md's postmortem). Mirror the frontend's `company-enrichment.spec.ts` pattern of waiting for a terminal state instead of asserting `status: expect.any(String)`.
- Manual: create a job for a brand-new company, confirm the Refresh button and populated fields appear in the UI (real end-to-end, not just API-level).

## Boundaries
- Always: keep the CAS-based conflict check from `CompaniesService.triggerEnrichment` — don't reintroduce the job-scoped controller's race-prone plain check anywhere.
- Ask first: none beyond normal PR review — no schema/migration in this phase, `CompanyProfile` untouched.
- Never: bundle the dead-code removal (step 4) with the redirect (steps 1-2) in the same PR — the redirect must be observed working correctly first.

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
