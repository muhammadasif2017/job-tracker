# Implementation Plan: Paste & Parse Quick Add

Spec: [paste-and-parse-quick-add-spec.md](./paste-and-parse-quick-add-spec.md)

## Overview
Add `POST /jobs/parse` (backend) that extracts `{company, position, location, url, jobType, source}` from a pasted URL or JD text, reusing `WebFetchService` + a new `LlmService.extractJobPosting()` method. Add a "Quick Add" frontend flow that calls it and pre-fills the existing `JobForm`. Vertically sliced: backend extraction path ships and is independently testable before any frontend work starts.

## Architecture Decisions
- Extraction logic lives in `EnrichmentModule` (`LlmService`, `WebFetchService`) — `JobsModule` already imports `EnrichmentModule` (confirmed in `jobs.module.ts`), so only `EnrichmentModule`'s `exports` array needs `WebFetchService` and `LlmService` added (currently only `EnrichmentService` is exported).
- Orchestration (`parseJobPosting`) lives in `JobsService`, not `EnrichmentService` — this is a job-creation concern, not company enrichment, and keeps `EnrichmentService`'s existing responsibility (BullMQ queue for `CompanyProfile`) untouched.
- No new BullMQ queue — synchronous request/response, per spec.
- `JobSource` inferred by domain match (`linkedin.com`→`LINKEDIN`, `indeed.com`→`INDEED`, `rozee.pk`→`ROZEE`, else `COMPANY_WEBSITE`/`OTHER`) rather than asking the LLM to guess — deterministic, no extra tool-schema field needed for source.

## Task List

### Phase 1: Backend extraction core

- [ ] **Task 1: Export `WebFetchService` + `LlmService` from `EnrichmentModule`**
  **Description:** Add both providers to `enrichment.module.ts`'s `exports` array so `JobsModule` can inject them.
  **Acceptance criteria:**
  - [ ] `EnrichmentModule` exports `EnrichmentService`, `WebFetchService`, `LlmService`.
  - [ ] Existing enrichment tests/behavior unchanged.
  **Verification:** `npx tsc --noEmit`; `npm test` (backend, existing suite green).
  **Dependencies:** None.
  **Files:** `backend/src/modules/enrichment/enrichment.module.ts`.
  **Scope:** XS.

- [ ] **Task 2: Add job-posting extraction to `LlmService`**
  **Description:** New `extractJobPosting(content: string): Promise<ParsedJobData>` method + new Groq tool schema (`extract_job_posting`) in `llm.service.ts`, following the exact pattern of `EXTRACT_TOOL`/`CompanyData`/`sanitize()` already in that file. Fields: `company`, `position`, `location`, `jobType` (enum `ONSITE|HYBRID|REMOTE|Unknown`). No `source` field — inferred separately (Task 3). On missing tool call or parse failure, throw (caller handles fallback per Task 4), matching existing `extract()` error behavior.
  **Acceptance criteria:**
  - [ ] New exported type (e.g. `ParsedJobData`) with fields matching `ParsedJobDto` from spec, minus `source`/`url`.
  - [ ] Sanitizer defaults missing/malformed fields to `undefined` (not `'Unknown'` string, since these feed a form, not a display field) — except `jobType`, which is constrained to the enum or omitted.
  - [ ] Existing `extract()`/`CompanyData` behavior and tests untouched.
  **Verification:** `npm test -- llm.service` — new unit suite covers: full extraction, partial/missing fields, malformed tool-call JSON, no-tool-call response.
  **Dependencies:** None (independent of Task 1, can be built in parallel).
  **Files:** `backend/src/modules/enrichment/services/llm.service.ts`, `backend/src/modules/enrichment/services/llm.service.spec.ts`.
  **Scope:** S.

### Checkpoint: Phase 1
- [ ] `npx tsc --noEmit` clean, `npm test` green (backend).
- [ ] `LlmService.extractJobPosting()` callable in isolation w/ a mocked Groq client — confirmed via unit test, no wiring into `JobsModule` yet.

### Phase 2: Backend endpoint

- [ ] **Task 3: `ParseJobDto` + `ParsedJobDto`**
  **Description:** New DTO files per spec's Code Style section — `ParseJobDto` (`url?`, `text?`, both optional but at least one required — enforce via class-validator custom validator or a manual check in the service/controller since class-validator doesn't do "at least one of" natively) and `ParsedJobDto` (`company?`, `position?`, `location?`, `url?`, `jobType?`, `source?`).
  **Acceptance criteria:**
  - [ ] `ParseJobDto` matches spec's `Code Style` snippet (`@IsUrl`, `@IsString`/`@MaxLength(20000)` for `text`).
  - [ ] Request with neither `url` nor `text` is rejected with 400 (existing `GlobalExceptionFilter`/NestJS validation pipe handles this once the validator is added).
  - [ ] `ParsedJobDto` fields are all optional (best-effort result, never a hard failure).
  **Verification:** `npx tsc --noEmit`; manual: POST with empty body → 400.
  **Dependencies:** None.
  **Files:** `backend/src/modules/jobs/dto/parse-job.dto.ts`, `backend/src/modules/jobs/dto/parsed-job.dto.ts`.
  **Scope:** XS.

- [ ] **Task 4: `JobsService.parseJobPosting()` orchestration**
  **Description:** Inject `WebFetchService` + `LlmService` into `JobsService`. Logic: if `url` given, call `fetchPageText(url)`; if result non-empty, extract from it; if empty (fetch failed) and `text` also given, extract from `text` instead; if only `text` given, extract from `text` directly. Wrap `extractJobPosting` in try/catch — on throw, return an empty/partial `ParsedJobDto` rather than propagating (per spec success criteria: "never throws a 500"). Apply domain→`JobSource` mapping (Task's Architecture Decision) when a `url` was supplied and reachable.
  **Acceptance criteria:**
  - [ ] URL success path: fetches, extracts, maps domain to `source`.
  - [ ] URL fetch failure + `text` present: falls back to `text` extraction, no error surfaced.
  - [ ] `text`-only input: extracts directly, `source` left `undefined` (no URL to infer from).
  - [ ] Extraction throwing (Groq error): returns `{}`-shaped `ParsedJobDto`, not a 500.
  **Verification:** `npm test -- jobs.service` — 4 new cases matching the acceptance criteria above, mocking `WebFetchService`/`LlmService`.
  **Dependencies:** Task 1, Task 2, Task 3.
  **Files:** `backend/src/modules/jobs/jobs.service.ts`, `backend/src/modules/jobs/jobs.service.spec.ts`.
  **Scope:** M.

- [ ] **Task 5: `POST /jobs/parse` controller route**
  **Description:** Add route to `JobsController` following existing Swagger decorator conventions (`@ApiOperation`, `@ApiCreatedResponse({ type: ParsedJobDto })` or `@ApiOkResponse`, matching whichever existing routes use for non-create POSTs).
  **Acceptance criteria:**
  - [ ] Route registered, protected by global `JwtAuthGuard` (no `@Public()` — same auth as rest of `JobsController`).
  - [ ] Swagger docs present.
  **Verification:** `npx tsc --noEmit`; manual: authenticated `curl`/Postman call against `start:dev` returns extracted fields for a real posting URL.
  **Dependencies:** Task 4.
  **Files:** `backend/src/modules/jobs/jobs.controller.ts`.
  **Scope:** XS.

- [ ] **Task 6: E2E test for `POST /jobs/parse`**
  **Description:** Add case(s) to `test/app.e2e-spec.ts` per spec's Testing Strategy — check how existing enrichment e2e tests avoid live Groq calls (mock or stub) and follow the same approach; if no existing pattern avoids live calls, flag to user before deciding whether this test hits real Groq (cost/flakiness tradeoff) or is skipped with a manual-verification note instead.
  **Acceptance criteria:**
  - [ ] At least one e2e case: valid text input → 200 with plausible fields.
  - [ ] At least one e2e case: empty body → 400.
  **Verification:** `npm run test:e2e` (requires local Postgres :5432).
  **Dependencies:** Task 5.
  **Files:** `backend/test/app.e2e-spec.ts`.
  **Scope:** S.

### Checkpoint: Phase 2 (backend complete)
- [ ] `npx tsc --noEmit`, `npm test`, `npm run test:e2e`, `npm run lint` all green.
- [ ] Manual check: real job posting URL → correct company/position via authenticated API call.
- [ ] **Manual accuracy pass (per spec):** run against 10+ real postings (LinkedIn, Indeed, Rozee), record hit rate before proceeding to frontend — bad extraction quality here means frontend UX will feel broken regardless of how well the form wiring works.
- [ ] Review with user before starting Phase 3.

### Phase 3: Frontend

- [ ] **Task 7: `JobForm` prefill support**
  **Description:** Add an optional `initialValues` (or similarly named) prop to `JobForm` that seeds `useForm`'s `defaultValues` for the create path (`isEdit` is `false`). Must not change existing create/edit behavior when the prop is omitted.
  **Acceptance criteria:**
  - [ ] `JobForm` renders with fields pre-populated when `initialValues` passed and `job` prop absent.
  - [ ] Existing create (no prefill) and edit (`job` prop) flows unaffected.
  **Verification:** `npm run build` (frontend); manual: open form both with and without prefill, confirm no regression.
  **Dependencies:** None (can be built in parallel with backend Phase 1-2).
  **Files:** `frontend/components/jobs/job-form.tsx`.
  **Scope:** S.

- [ ] **Task 8: `QuickAdd` component**
  **Description:** New component per spec's Project Structure (`quick-add.tsx`) — a modal/panel with a single paste input (URL or text, same field, let the component decide server-side dispatch by simple heuristic or send both), calls `POST /jobs/parse` via existing `api` client, shows loading state, then opens `JobForm` with `initialValues` set from the response (Task 7).
  **Acceptance criteria:**
  - [ ] Paste + submit → loading indicator → `JobForm` opens pre-filled.
  - [ ] Extraction failure (empty `ParsedJobDto`) still opens `JobForm`, just empty/mostly-empty — never a dead end or silent failure.
  - [ ] Network/API error shows a toast (matches existing `sonner` usage in `job-form.tsx`) rather than an unhandled rejection.
  **Verification:** `npm run build`; manual browser test: paste a real URL, confirm prefilled form; paste raw text, confirm same; trigger a failure (bad URL), confirm graceful empty-form fallback.
  **Dependencies:** Task 6 (backend endpoint live), Task 7.
  **Files:** `frontend/components/jobs/quick-add.tsx`.
  **Scope:** M.

- [ ] **Task 9: Wire Quick Add into jobs page**
  **Description:** Add entry point in `frontend/app/(dashboard)/jobs/page.tsx` alongside existing "Add Job" button (per spec's still-open placement question — default to "alongside," not replacing, unless user says otherwise before this task starts).
  **Acceptance criteria:**
  - [ ] Quick Add reachable from jobs page.
  - [ ] Existing "Add Job" (blank form) flow unchanged.
  **Verification:** `npm run build`; manual: full flow in browser — paste → review → save → job appears in list (existing `['jobs', filters]` query invalidation should already handle refresh since `QuickAdd` ends in the same `POST /jobs` mutation as regular create).
  **Dependencies:** Task 8.
  **Files:** `frontend/app/(dashboard)/jobs/page.tsx`.
  **Scope:** XS.

### Checkpoint: Phase 3 (feature complete)
- [ ] `npm run build`, `npm run lint` green (frontend); full backend checkpoint from Phase 2 still green.
- [ ] End-to-end manual run: paste real posting URL on running app → prefilled form → edit → save → job visible in list with correct data.
- [ ] End-to-end manual run: paste raw JD text (simulating login-walled posting) → same outcome.
- [ ] Ready for user review / PR.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| LLM extraction accuracy too low on real postings | High — feature feels broken despite working code | Manual accuracy checkpoint at end of Phase 2, before frontend work starts (fail fast) |
| `WebFetchService` can't reach many real postings (JS-rendered SPAs, login walls) | Med — URL path degrades to "always paste text" | Already designed as fallback path (Task 4), not a blocker; just changes which input mode gets used most |
| E2E test hitting live Groq API — cost/flakiness | Low-Med | Task 6 explicitly flags this for a decision before writing the test, rather than assuming |
| `JobSource` domain-mapping too rigid (misses valid variants like `linkedin.co.uk`) | Low | Best-effort only; user can always correct in `JobForm` before saving — no correctness requirement on this field |

## Open Questions
- Quick Add button placement (alongside vs. replacing "Add Job") — plan defaults to "alongside" for Task 9; confirm before that task or change then.
- Rate limiting on `POST /jobs/parse` — not addressed in this plan; flag if it becomes a real cost/abuse concern before Task 5 ships.
- Whether Task 6's e2e test should hit live Groq or be stubbed — decide when Task 6 starts, based on how existing enrichment e2e tests handle this.
