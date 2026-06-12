# Implementation Plan: Company Intelligence Enrichment

Spec: `docs/specs/company-enrichment.md`

## Tasks

### Phase 1 — Data Layer

- [x] **Task 1: Prisma schema — add CompanyProfile**
  - Acceptance: `schema.prisma` has `CompanyProfile` model + `EnrichmentStatus` enum; `prisma migrate dev` runs clean; `prisma generate` succeeds; `npx tsc --noEmit` passes.
  - Verify: `npx tsc --noEmit` in `backend/`
  - Files: `backend/prisma/schema.prisma`

### Phase 2 — Backend Infrastructure

- [x] **Task 2: Install backend dependencies**
  - Acceptance: `@nestjs/bullmq`, `bullmq`, `@anthropic-ai/sdk`, `cheerio` appear in `package.json` dependencies; `npx tsc --noEmit` still passes.
  - Verify: `npm ls @nestjs/bullmq bullmq @anthropic-ai/sdk cheerio` in `backend/`
  - Files: `backend/package.json`, `backend/package-lock.json`

- [x] **Task 3: WebFetchService**
  - Acceptance: `fetchPageText(url)` fetches a URL and returns plain text with HTML tags stripped; returns `''` on error (never throws).
  - Verify: `npm test -- --testPathPattern=web-fetch` in `backend/`
  - Files: `backend/src/enrichment/services/web-fetch.service.ts`, `backend/src/enrichment/services/web-fetch.service.spec.ts`

- [x] **Task 4: SearchService**
  - Acceptance: `search(query)` calls Brave Search API and returns an array of text snippets; returns `[]` if `BRAVE_SEARCH_API_KEY` is unset.
  - Verify: `npm test -- --testPathPattern=search.service` in `backend/`
  - Files: `backend/src/enrichment/services/search.service.ts`, `backend/src/enrichment/services/search.service.spec.ts`

- [x] **Task 5: LlmService**
  - Acceptance: `extract(companyName, context)` calls Claude via tool_use and returns a typed `CompanyData` object; if Claude returns no tool call, returns all-`'Unknown'` defaults.
  - Verify: `npm test -- --testPathPattern=llm.service` in `backend/`
  - Files: `backend/src/enrichment/services/llm.service.ts`, `backend/src/enrichment/services/llm.service.spec.ts`

- [x] **Task 6: EnrichmentProcessor**
  - Acceptance: Worker runs the pipeline (search → fetch → llm → save); sets `COMPLETED` on success and `FAILED` + `errorMessage` on any thrown error; never rethrows.
  - Verify: `npm test -- --testPathPattern=enrichment.processor` in `backend/`
  - Files: `backend/src/enrichment/enrichment.processor.ts`, `backend/src/enrichment/enrichment.processor.spec.ts`

- [x] **Task 7: EnrichmentModule + EnrichmentService**
  - Acceptance: Module compiles with BullMQ queue registered; `EnrichmentService.enqueueEnrichment(jobId)` adds a job to the `'company-enrichment'` queue.
  - Verify: `npx tsc --noEmit` in `backend/`
  - Files: `backend/src/enrichment/enrichment.module.ts`, `backend/src/enrichment/enrichment.service.ts`

- [x] **Task 8: EnrichmentController + AppModule**
  - Acceptance: `POST /jobs/:id/enrich` returns `{ message: 'Enrichment queued' }`; returns 404 if job doesn't belong to user; `AppModule` imports `EnrichmentModule`.
  - Verify: `npx tsc --noEmit` + manual curl (or e2e test if easy to add)
  - Files: `backend/src/enrichment/enrichment.controller.ts`, `backend/src/app.module.ts`

### Phase 3 — Jobs Integration

- [x] **Task 9: Auto-enqueue on job create + GET /jobs/:id includes companyProfile**
  - Acceptance: `JobsService.create()` calls `EnrichmentService.enqueueEnrichment(job.id)` after save; `JobsService.findOne()` includes `companyProfile` in the Prisma query.
  - Verify: `npx tsc --noEmit`
  - Files: `backend/src/jobs/jobs.service.ts`, `backend/src/jobs/jobs.module.ts`

### Phase 4 — Documentation

- [x] **Task 10: Update .env.example files**
  - Acceptance: Both root `.env.example` and `backend/` env docs mention `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY`, `REDIS_URL`.
  - Verify: Visual check
  - Files: `.env.example`, any backend `.env.example`

### Phase 5 — Frontend

- [x] **Task 11: CompanyProfileCard component**
  - Acceptance: Component renders skeleton while `PENDING`/`PROCESSING`; renders structured card for `COMPLETED`; renders error state for `FAILED`; includes "Refresh" button.
  - Verify: `npm run build` in `frontend/`
  - Files: `frontend/components/company-profile-card.tsx`

- [x] **Task 12: Wire CompanyProfileCard into job detail page**
  - Acceptance: Job detail page shows `CompanyProfileCard`; TanStack Query polls every 3s while status is `PENDING`/`PROCESSING`; stops on `COMPLETED`/`FAILED`.
  - Verify: `npm run build` in `frontend/`
  - Files: `frontend/app/(dashboard)/jobs/[id]/page.tsx`
