# Spec: Paste & Parse Quick Add

## Objective
Let a user paste a job posting URL or raw job-description text and get a pre-filled `JobForm` instead of typing company/position/location/type/source by hand. User reviews/edits before saving — nothing is auto-created.

Source idea: [docs/ideas/paste-and-parse-quick-add.md](./paste-and-parse-quick-add.md).

**User story:** As a solo user tracking applications, when I find a posting I want to apply to, I paste the URL (or the JD text if the page is login-walled) into "Quick Add," get a form pre-filled with the extracted fields, fix anything wrong, and save — instead of manually typing every field.

**Success criteria:**
- `POST /jobs/parse` accepts `{ url?: string; text?: string }` (at least one required) and returns best-effort extracted fields; never throws a 500 on extraction failure — returns partial/empty fields instead.
- Given a real, reachable job posting URL (LinkedIn/Indeed public posting), extracted `company` and `position` are correct in a manual spot-check of 10+ real postings.
- Given raw pasted JD text (no URL), same extraction quality, no `WebFetchService` call.
- Frontend "Quick Add" opens `JobForm` pre-filled from the parse response; existing create flow (`POST /jobs`) is unchanged — Quick Add only changes how the form's initial values are populated.
- No new Job model fields, no new BullMQ queue, no background job.

## Tech Stack
NestJS 11 backend (Prisma 7 + `@prisma/adapter-pg`), Next.js 16 frontend (RHF + Zod), Groq SDK (`groq-sdk`) for extraction, `cheerio` for HTML text extraction — all already in use, no new dependencies.

## Commands
```bash
# Backend
cd backend
npm run start:dev       # watch mode :3001
npx tsc --noEmit        # type check
npm test                # unit tests (jest)
npm run test:e2e        # e2e (requires local Postgres :5432)
npm run lint

# Frontend
cd frontend
npm run dev             # :3000
npm run build           # required before calling frontend work done (catches type errors tsc misses)
npm run lint
```

## Project Structure
```
backend/src/modules/enrichment/
  enrichment.module.ts          → export WebFetchService, LlmService (currently only EnrichmentService exported)
  services/web-fetch.service.ts → reused as-is (fetchPageText(url))
  services/llm.service.ts       → add new tool schema + extract method for job postings, alongside existing CompanyData/EXTRACT_TOOL

backend/src/modules/jobs/
  jobs.module.ts        → import EnrichmentModule
  jobs.controller.ts    → add POST /jobs/parse
  jobs.service.ts        → add parseJobPosting(dto) orchestration
  dto/parse-job.dto.ts        → new: { url?, text? }
  dto/parsed-job.dto.ts       → new: { company, position, location, url, jobType, source } (all optional/best-effort)

frontend/components/jobs/
  job-form.tsx           → accept optional initialValues/prefill prop (or reuse existing defaultValues path)
  quick-add.tsx           → new: paste box (url or text), calls POST /jobs/parse, opens JobForm pre-filled

frontend/app/(dashboard)/jobs/page.tsx → add Quick Add entry point next to existing "Add Job" button
```

## Code Style

Backend DTO (matches `dto/create-job.dto.ts` exactly):
```ts
export class ParseJobDto {
  @ApiPropertyOptional({ example: 'https://jobs.example.com/123' })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({ example: 'Senior Engineer at Acme...' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;
}
```

LLM extraction follows the existing `EXTRACT_TOOL`/`sanitize()` pattern in `llm.service.ts` — new `extractJobPosting(content: string)` method, new Groq tool schema (`extract_job_posting`), same `str()`-style sanitization so missing fields degrade to `undefined`/`'Unknown'` rather than throwing. `WebFetchService.fetchPageText(url)` is called unmodified — it already returns `''` on failure (login-wall, timeout, unsafe URL), which becomes the trigger for "fall back to text if the caller also supplied it, otherwise return an empty parse result."

## Testing Strategy
- **Unit (jest, `*.spec.ts` alongside source):** `llm.service.spec.ts` gets a new suite for the job-posting extraction method (mock Groq client, verify sanitization of missing/malformed fields — mirrors existing `CompanyData` tests). `jobs.service.spec.ts` gets a suite for `parseJobPosting()` covering: URL success, URL fetch failure + text fallback, text-only input, extraction throwing (service must not propagate 500 — return empty/partial `ParsedJobDto`).
- **E2E (`test/app.e2e-spec.ts`, live dev Postgres):** one happy-path test hitting `POST /jobs/parse` with a stubbed/mocked LLM call if the suite doesn't hit real Groq (check existing enrichment e2e tests for how they avoid live external calls — follow the same pattern).
- **Manual verification:** run `parseJobPosting` against 10+ real job posting URLs (LinkedIn, Indeed, Rozee) and record accuracy before calling extraction "done" — this is explicitly called out because LLM extraction accuracy can't be unit-tested meaningfully.
- **Frontend:** no existing frontend test suite pattern for forms found beyond `vitest`/`playwright` scripts — add a `playwright` e2e case for the Quick Add → prefill → edit → save flow if time allows; not blocking for MVP given personal-tool scope.

## Boundaries
- **Always:** run `npx tsc --noEmit`, `npm test`, `npm run lint` (backend) and `npm run build`, `npm run lint` (frontend) before considering any task done. Never let extraction failure return a 5xx — always degrade to partial/empty fields per success criteria.
- **Ask first:** exporting `WebFetchService`/`LlmService` from `EnrichmentModule` (touches a shared module's public surface); any change to `schema.prisma` (none planned, but flag if scope grows to need one); any new dependency.
- **Never:** auto-create a `Job` without user review through `JobForm`; add a new BullMQ queue for this (explicitly out of scope — sync request/response only); commit `GROQ_API_KEY` or other secrets.

## Open Questions
- Where exactly should the Quick Add entry point live in `frontend/app/(dashboard)/jobs/page.tsx` — replace "Add Job" button or sit alongside it? (deferred from idea doc, still open)
- Rate limiting on `POST /jobs/parse` — should it share whatever throttling (if any) exists on the enrichment queue, given it adds a new synchronous Groq call path?
- Domain → `JobSource` mapping: full enum is `LINKEDIN, INDEED, ROZEE, COMPANY_WEBSITE, REFERRAL, OTHER` (schema.prisma:30-37). Map `linkedin.com`→`LINKEDIN`, `indeed.com`→`INDEED`, `rozee.pk`→`ROZEE`; anything else falls back to `COMPANY_WEBSITE` if the URL's domain matches an extracted company name, else `OTHER`. `REFERRAL` is never inferable from a URL — only reachable via manual edit in `JobForm`, same as today.
