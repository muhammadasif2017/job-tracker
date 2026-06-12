# Spec: Company Intelligence Enrichment

## Objective

When a user adds a job application, an LLM agent automatically researches the company in the background and surfaces structured intelligence: what the company does, their tech stack, work culture, size, and remote policy.

**User story:** As a job seeker, I want to see a company profile card on each job's detail page so I can quickly evaluate the company without leaving the app — and re-run the analysis if the data looks stale.

**Success looks like:** Within ~30 seconds of adding a job, the detail page shows a populated company card with industry, size, tech stack, culture summary, remote policy, and work-life balance rating.

---

## Tech Stack

| Layer      | Technology                                              |
|------------|---------------------------------------------------------|
| Backend    | NestJS 11, Prisma 7, PostgreSQL                         |
| Queue      | BullMQ + Redis (self-hosted on Oracle VM)               |
| LLM        | Anthropic Claude (`claude-haiku-4-5-20251001` — cheap, fast) |
| Search     | Brave Search API (free tier: 2000 req/month)            |
| Web fetch  | Node.js native `fetch` + `cheerio` for HTML stripping   |
| Frontend   | Next.js 16 App Router, TanStack Query v5                |

---

## Commands

```bash
# Backend
npm run start:dev                              # dev server on :3001
npx prisma migrate dev --name add-company-profile
npx prisma generate                            # always after migrate
npx tsc --noEmit                              # type check

# Redis (Oracle VM)
sudo systemctl start redis                     # or: docker compose up redis

# Frontend
npm run dev                                    # dev server on :3000
```

---

## Project Structure

### New backend module

```
backend/src/enrichment/
  enrichment.module.ts        # Registers BullMQ queue + imports sub-services
  enrichment.service.ts       # enqueueEnrichment(jobId) / triggerEnrichment(userId, jobId)
  enrichment.processor.ts     # @Processor('company-enrichment') — BullMQ worker
  enrichment.controller.ts    # POST /jobs/:id/enrich  (manual re-trigger)
  services/
    web-fetch.service.ts      # fetchPageText(url): Promise<string>  (strips HTML)
    search.service.ts         # search(query): Promise<string[]>  (Brave API, returns snippets)
    llm.service.ts            # extract(companyName, context): Promise<CompanyData>
```

### New frontend component

```
frontend/src/components/company-profile-card.tsx   # Displays enrichment data
```

### Modified files

```
backend/prisma/schema.prisma               # +CompanyProfile model, +EnrichmentStatus enum
backend/src/jobs/jobs.service.ts           # create() enqueues enrichment after save
backend/src/jobs/jobs.controller.ts        # findOne includes companyProfile
backend/src/app.module.ts                  # imports EnrichmentModule
backend/.env.example                       # +ANTHROPIC_API_KEY, +BRAVE_SEARCH_API_KEY, +REDIS_URL
frontend/src/app/(dashboard)/jobs/[id]/    # add CompanyProfileCard to detail page
```

---

## Database Schema Changes

```prisma
enum EnrichmentStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model CompanyProfile {
  id              String           @id @default(cuid())
  jobId           String           @unique
  job             Job              @relation(fields: [jobId], references: [id], onDelete: Cascade)
  status          EnrichmentStatus @default(PENDING)
  industry        String?
  companySize     String?          // "Startup (<50)", "Small (50-200)", etc.
  techStack       String[]
  cultureSummary  String?
  remotePolicy    String?          // "Remote", "Hybrid", "On-site", "Unknown"
  workLifeBalance String?          // "Excellent", "Good", "Average", "Below Average", "Unknown"
  headquarters    String?
  founded         String?
  errorMessage    String?
  enrichedAt      DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  @@map("company_profiles")
}

// Add to Job model:
companyProfile  CompanyProfile?
```

---

## Enrichment Pipeline

```
JobsService.create()
    │
    ▼
prisma.job.create()  ──── (atomic, existing behaviour unchanged)
    │
    ▼
EnrichmentService.enqueueEnrichment(jobId)
    │
    ▼  (async — returns immediately)
BullMQ queue: 'company-enrichment'
    │
    ▼
EnrichmentProcessor.process(job)
    ├─ 1. Create CompanyProfile { status: PROCESSING }
    ├─ 2. BraveSearch: "{company} company culture reviews"
    ├─ 3. BraveSearch: "{company} tech stack engineering blog"
    ├─ 4. WebFetch: company URL from Job.url  (or top search result)
    ├─ 5. Aggregate text (search snippets + page text, truncated to ~6000 chars)
    ├─ 6. Claude: extract structured CompanyData (tool_use for reliable JSON)
    ├─ 7. Update CompanyProfile { status: COMPLETED, ...fields, enrichedAt }
    └─ On any error → { status: FAILED, errorMessage }
```

**BullMQ options:**
- `attempts: 2` — retry once on transient failures
- `backoff: { type: 'fixed', delay: 10_000 }` — 10s between retries
- No delay on initial attempt

---

## API Changes

### Existing: `GET /jobs/:id`
Include `companyProfile` in the response:
```ts
prisma.job.findFirst({
  where: { id: jobId, userId },
  include: { companyProfile: true },
})
```

### New: `POST /jobs/:id/enrich`
Manual re-trigger. Protected by `JwtAuthGuard` (default). Verifies job ownership via `JobsService.findOne()`.

- If CompanyProfile exists: resets `status → PENDING`, clears all extracted fields, re-enqueues.
- If no CompanyProfile: creates one with `status: PENDING`, enqueues.
- Returns `{ message: 'Enrichment queued' }` immediately.

---

## LLM Extraction

**Model:** `claude-haiku-4-5-20251001` — fast and cheap, sufficient for structured extraction.

**Method:** Claude tool_use with a single tool `extract_company_data` — guarantees structured JSON output, no parsing heuristics needed.

**Tool definition:**
```ts
{
  name: 'extract_company_data',
  description: 'Extract structured company information from web content',
  input_schema: {
    type: 'object',
    properties: {
      industry:        { type: 'string' },
      companySize:     { type: 'string', enum: ['Startup (<50)', 'Small (50-200)', 'Mid-size (200-1000)', 'Large (1000-5000)', 'Enterprise (5000+)', 'Unknown'] },
      techStack:       { type: 'array', items: { type: 'string' } },
      cultureSummary:  { type: 'string', description: '2-3 sentences about work culture' },
      remotePolicy:    { type: 'string', enum: ['Remote', 'Hybrid', 'On-site', 'Unknown'] },
      workLifeBalance: { type: 'string', enum: ['Excellent', 'Good', 'Average', 'Below Average', 'Unknown'] },
      headquarters:    { type: 'string' },
      founded:         { type: 'string' },
    },
    required: ['industry', 'companySize', 'techStack', 'cultureSummary', 'remotePolicy', 'workLifeBalance', 'headquarters', 'founded'],
  },
}
```

**Prompt:**
```
You are helping a job applicant evaluate a company. Extract structured data from the following web content about "{companyName}".

If information is not available in the provided content, use "Unknown" for string fields and [] for arrays. Do not guess or hallucinate data not present in the content.

Web content:
{aggregatedText}
```

---

## Frontend: CompanyProfileCard

Displayed on the job detail page. Three states:

**PENDING / PROCESSING:** Skeleton loader with "Researching company..." label.

**COMPLETED:** Structured card showing:
- Industry + company size (header row)
- Tech stack (badge list)
- Culture summary (prose)
- Remote policy, Work-life balance, Headquarters, Founded (metadata row)
- "Refresh" button (calls `POST /jobs/:id/enrich`, then invalidates query)

**FAILED:** Error state with retry button and optional `errorMessage`.

**Polling:** TanStack Query `refetchInterval`:
```ts
refetchInterval: (query) => {
  const status = query.state.data?.companyProfile?.status;
  return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
}
```

---

## New Environment Variables

| Variable               | Required | Notes                                      |
|------------------------|----------|--------------------------------------------|
| `ANTHROPIC_API_KEY`    | Yes      | From console.anthropic.com                 |
| `BRAVE_SEARCH_API_KEY` | Yes      | Free tier: 2000 req/month — plenty         |
| `REDIS_URL`            | No       | Default: `redis://localhost:6379`           |

---

## New Dependencies

### Backend
```bash
npm install @nestjs/bullmq bullmq @anthropic-ai/sdk cheerio
npm install --save-dev @types/cheerio
```

### Frontend
No new dependencies — TanStack Query already handles polling.

---

## Testing Strategy

- **Unit tests:** `LlmService.extract()` — mock the Anthropic SDK, verify tool_use parsing. `WebFetchService.fetchPageText()` — mock fetch, verify HTML stripping.
- **Integration:** `POST /jobs/:id/enrich` endpoint — mock the queue enqueue, verify job ownership check.
- **E2E:** Out of scope (requires live Redis + Anthropic key). Manual smoke test is sufficient.

---

## Boundaries

**Always do:**
- Verify job ownership before enqueuing (`findOne(userId, jobId)` ownership check)
- Set `status: FAILED` + store `errorMessage` on any processor error — never let the record get stuck in PROCESSING
- Truncate aggregated web content to ≤ 8000 chars before sending to Claude (cost + context limit)
- Use `tool_use` (not freeform text) for Claude extraction to get reliable JSON

**Ask first:**
- Changing the LLM model (cost implications)
- Adding new data sources beyond website + Brave Search
- Adding WebSocket/SSE instead of polling for real-time status updates

**Never do:**
- Log raw web-fetched content (may contain PII or large payloads)
- Store Claude API keys in code or commit them
- Throw unhandled exceptions in the processor (BullMQ will retry but status won't update to FAILED)

---

## Success Criteria

- [ ] Adding a job creates a `CompanyProfile` with `status: PENDING` within the same request
- [ ] Within ~30 seconds, the profile card on the job detail page shows real company data
- [ ] If enrichment fails, the card shows a failure state with a retry button
- [ ] `POST /jobs/:id/enrich` works: resets and re-queues enrichment; returns 403 if wrong user
- [ ] Polling stops once `status` is `COMPLETED` or `FAILED`
- [ ] `GET /jobs/:id` includes `companyProfile` in the response
- [ ] Deleting a job cascades and removes the `CompanyProfile`
- [ ] All new env vars are documented in `.env.example`

---

## Open Questions

None — all major decisions resolved above. Implementation can begin.
