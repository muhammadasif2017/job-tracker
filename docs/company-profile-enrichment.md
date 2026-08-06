# Company Profile Enrichment — End-to-End

How a job's `CompanyProfile` (industry, headquarters, tech stack, culture, address, etc.) gets researched, extracted, guarded, and shown to the user. Covers the full path: job creation → BullMQ queue → search/fetch → LLM extraction → deterministic guards → DB write → frontend polling/display.

Related ADRs (decision history, not repeated here): [001](decisions/001-async-enrichment-queue.md) (why BullMQ), [002](decisions/002-llm-tool-use-extraction.md) (why tool-call extraction), [003](decisions/003-company-profile-separate-model.md) (why a separate model), [007](decisions/007-groq-llm-migration.md) (Groq migration), [011](decisions/011-enrichment-search-disambiguation.md) (search disambiguation), [013](decisions/013-enrichment-address-trust-guard.md) (the address guard this doc's guard section extends).

## 1. Data model

`backend/prisma/schema.prisma` — `CompanyProfile`, 1:1 optional relation to `Job`, cascade delete:

```prisma
model CompanyProfile {
  id              String           @id @default(cuid())
  jobId           String           @unique
  job             Job              @relation(fields: [jobId], references: [id], onDelete: Cascade)
  status          EnrichmentStatus @default(PENDING)
  industry        String?
  companySize     String?
  techStack       String[]
  cultureSummary  String?
  workPolicy      String?
  workLifeBalance String?
  headquarters    String?
  headquartersLowConfidence Boolean @default(false)
  address         String?
  addressLowConfidence     Boolean @default(false)
  founded         String?
  errorMessage    String?
  enrichedAt      DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}
```

`EnrichmentStatus`: `PENDING | PROCESSING | COMPLETED | FAILED`. No field is ever `null` mid-flight except the descriptive ones, which stay `null` until a `COMPLETED` write (or resolve to `"Unknown"` string values inside that write — see §5).

`addressLowConfidence` / `headquartersLowConfidence` — added to support "show something, flagged, over showing nothing" (see §6): the anti-collision guard on these two fields keeps the extracted value and sets the matching flag instead of overwriting to `"Unknown"` when confidence is low. Default `false` for every other field/every run that doesn't hit the low-confidence path.

## 2. Trigger paths

Two ways enrichment gets queued — both funnel into the same `EnrichmentService.enqueueEnrichment(jobId)`:

| Trigger | Where | Notes |
|---|---|---|
| **Automatic, on job creation** | `backend/src/modules/jobs/jobs.service.ts:149` — fired right after the `Job` row is created | Best-effort: wrapped so a queue/Redis failure doesn't fail job creation itself |
| **Manual re-run** | `POST /jobs/:id/enrichment` → `EnrichmentController` → same `enqueueEnrichment` | Used by the frontend's "Refresh" button (§7) — after a `FAILED` run, or to re-research a `COMPLETED` profile on demand |

`EnrichmentService.enqueueEnrichment` (`enrichment.service.ts`):
1. `companyProfile.upsert` — resets to `status: PENDING`, nulls out all descriptive fields and `errorMessage`/`enrichedAt` (so a re-run doesn't show stale data while the new run is in flight).
2. Adds a BullMQ job (`{ jobId }`) to the `company-enrichment` queue: `attempts: 2`, `backoff: { type: 'fixed', delay: 10_000 }`.

**Duplicate-run guard**: `EnrichmentController.triggerEnrichment` (the manual-POST path only) checks the existing profile's status first — if `PENDING` or `PROCESSING`, throws `ConflictException` (409) rather than enqueuing a second run. The automatic on-create path doesn't need this check since a profile can't already exist for a job that's still being created.

## 3. The queue

BullMQ + Redis, worker runs in-process (`EnrichmentProcessor extends WorkerHost`, `@Processor(ENRICHMENT_QUEUE)`). `ENRICHMENT_QUEUE = 'company-enrichment'`.

```
enrichment.processor.ts
@Processor(ENRICHMENT_QUEUE, { lockDuration: 90_000 })
```

`lockDuration: 90_000` (90s) — added because no worker timeout/lock config existed before. **This is stall-detection margin, not a runtime ceiling**: `@nestjs/bullmq`'s Worker auto-renews the lock at `lockDuration / 2` (~45s) while the job is actively processing, so a long-but-healthy run never loses its lock from wall-clock length alone. What it actually protects against is a *stalled* job — a crashed worker process or a blocked event loop that stops the renewal timer — which would otherwise let BullMQ hand the job to a second worker and duplicate the Tavily + Groq spend. 90s is generous margin over the ~45s renewal cadence (won't false-trigger on a GC pause) while still catching a genuinely wedged worker in a reasonable window.

Retry: `attempts: 2`, fixed 10s backoff. On failure the processor's `catch` block writes `status: FAILED` + a sanitized `errorMessage` (URLs stripped, capped at 200 chars) before rethrowing — the rethrow is what makes BullMQ actually retry.

## 4. The pipeline (`EnrichmentProcessor.process`)

Runs once per job (once more per attempt, on retry). Step by step:

**4.1 — Domain resolution**
```ts
const domain = this.extractDomain(dbJob.url);
```
Hostname of the job posting's URL, minus `www.` — but only if it's *not* a known job-board host (`linkedin.com`, `indeed.com`, `glassdoor.com`, `rozee.pk`, `bayt.com`, `monster.com`, `ziprecruiter.com`, `wellfound.com`, or any subdomain of these). A job-board URL yields `domain = undefined`, which disables every domain-scoped fetch/search below — a job board is never treated as "the company's own site."

**4.2 — General web search**
```ts
const generalQuery = `"${company}"${locationSuffix} company overview headquarters address founded employees industry tech stack work culture reviews`;
const snippets = await this.search.search(generalQuery);
```
One Tavily call (`SearchService`, `services/search.service.ts`), no domain restriction. Returns up to 5 results + Tavily's synthesized "answer" (appended *last*, not first, so it can't dominate extraction if wrong). Each snippet is prefixed `[title | source-domain]` so the LLM can judge provenance. If `TAVILY_API_KEY` is unset, this silently returns `[]` (no throw) — enrichment degrades to page-fetch-only, doesn't fail outright.

**4.3 — Official-page fetches** (all in one `Promise.all`, each independently soft-failing to `''` on error/timeout via `WebFetchService`, 10s each):

| Fetch | URL | Condition |
|---|---|---|
| Job posting page | `dbJob.url` | Always |
| Homepage | `https://{domain}` | Only if `domain` known |
| About page | `https://{domain}/about` | Only if `domain` known |
| Contact page | `https://{domain}/contact` | Only if `domain` known |

Then, sequentially (not parallel — only runs if needed): if the contact-page fetch above came back empty, fetch `https://{domain}/contact-us` as a fallback. `WebFetchService.fetchPageText` strips `<script>/<style>`, extracts `<body>` text, blocks internal/private URLs (localhost, RFC-1918 ranges), and truncates to `LLM_CONTEXT_BUDGET` (8000 chars) per page.

**4.4 — Domain-scoped fallback search** (conditional, added to control Tavily quota):
```ts
const newOfficialText = [...contactTexts, aboutText, homepageText].join('');
const shouldFallbackSearch = domain !== undefined && newOfficialText.length < 300;
const domainSnippets = shouldFallbackSearch
  ? await this.search.search(generalQuery, { includeDomains: [domain] })
  : [];
```
Fires a **second** Tavily call, restricted to the company's own domain via `include_domains`, but *only* when the official-page fetches above came back thin (<300 chars combined) — i.e. a failed/near-empty fetch, not the routine case. This matters because a domain is known for most real (non-job-board) postings; firing this unconditionally would roughly double Tavily usage against the free tier's 1000 req/month for no benefit in the common case where the direct page fetches already succeeded. `pageText` (the job-posting page) is deliberately excluded from the 300-char check — it's unrelated to whether the official-site fetches succeeded and routinely exceeds 300 chars on its own, which would otherwise mask a real thin-fetch case.

**4.5 — Assembling the context**

```ts
const officialParts = [
  ...new Set([...contactTexts, aboutText, homepageText, ...domainSnippets, pageText]),
].filter(Boolean);
```

Order is deliberate and load-bearing: **contact text first** (most likely to carry a street address, and short), then about, then homepage (marketing-heavy, least structured), then domain-scoped fallback snippets, then the job-posting page last (lowest priority — most marketing-heavy pre-existing source). This order survives the truncation below — anything after the cutoff is silently dropped, so putting the address-bearing content first means it's the last thing to get crowded out.

```ts
sections.push(`${label}\n${officialParts.join('\n\n').slice(0, 6000)}`);   // official section, 6000-char cap
sections.push(`...\n${searchParts.join('\n\n').slice(0, 3500)}`);          // general search section, 3500-char cap
```

Two labeled sections are sent to the LLM: `=== OFFICIAL COMPANY WEBSITE (domain) ===` (or `=== JOB POSTING PAGE ===` if no domain) and `=== WEB SEARCH RESULTS (may describe other companies with similar names) ===`. The label difference is itself a signal the LLM prompt refers to.

`LOG_LEVEL=debug` logs the full assembled context (`enrichment_context` event) — the primary tool for diagnosing a wrong extraction after the fact.

## 5. LLM extraction (`LlmService.extract`)

`backend/src/modules/enrichment/services/llm.service.ts`. Model: `llama-3.3-70b-versatile` via Groq, forced tool-call (`tool_choice: 'required'`) against a fixed JSON schema (`extract_company_data`) — see ADR-002 for why tool-call over free-text parsing.

- Client constructed with **`timeout: 45_000`** (45s) and **`maxRetries: 1`** (explicitly pinned) — a hard, closed-form upper bound per request. `groq-sdk` retries a client-side timeout internally (`client.js:226-246`), up to `maxRetries`, *before* it ever throws to our code — leaving `maxRetries` at the SDK's own default of 2 would make worst-case Groq time 30s × 3 = 90s on its own, silently exceeding the `lockDuration` margin in §3 with no visibility from this file. Pinning `maxRetries: 1` makes it 45s × 2 = 90s instead — deliberately equal to `lockDuration`, since the lock is a renewal-stall margin rather than a hard ceiling (§3). Full worst-case chain: ≈40s search/fetch chain + 90s Groq (first attempt + one SDK-internal retry) ≈130s for a single BullMQ attempt — long, but each `attempts` retry re-acquires its own fresh lock, so this doesn't compound across BullMQ's own `attempts: 2`.
- `createWithRetry` — one *additional* immediate retry, specifically if Groq returns a `tool_use_failed` 400 (a known generation-time glitch, not a timeout or connection error, so it isn't covered by the SDK's own retry above) — cheaper than falling through to a full BullMQ retry, which re-runs search/fetch too.
- Prompt explicitly restricts `address` sourcing to "OFFICIAL COMPANY WEBSITE" content only, and instructs the model to return `"Unknown"`/`[]` rather than guess when content describes a different, same-named company. `disambiguation` hints (`domain`, `location`) are appended when available (ADR-011). **These are prompt-level instructions, not enforced** — hence the deterministic guard in §6, added after prompt-only mitigations empirically failed (ADR-013).
- `sanitize()` normalizes the raw tool-call JSON: any blank/whitespace-only string field becomes `"Unknown"`, `techStack` filters to only actual non-empty strings (defends against the model returning `null`/mixed-type arrays).

## 6. Deterministic post-extraction guards

Prompt instructions alone don't stop the model from taking a value from a same-name collision company in the search results (see ADR-013's production incident). Two fields get a hard, code-level check *after* extraction, not just a prompt instruction:

```ts
const officialTokens = new Set(
  this.normalize(officialParts.join(' ')).split(' ').filter(Boolean),
);
const guardThresholds = { address: 0.7, headquarters: 0.4 };
const lowConfidence = { address: false, headquarters: false };

for (const field of ['address', 'headquarters'] as const) {
  const value = data[field];
  if (!value || value === 'Unknown') continue;
  const tokens = this.normalize(value).split(' ').filter(Boolean);
  const hits = tokens.filter((t) => officialTokens.has(t)).length;
  if (!tokens.length || hits / tokens.length < guardThresholds[field]) {
    lowConfidence[field] = true;   // keep the value, flag it — not "Unknown"
  }
}
// ...
await this.prisma.companyProfile.update({
  data: {
    ...data,
    addressLowConfidence: lowConfidence.address,
    headquartersLowConfidence: lowConfidence.headquarters,
    // ...
  },
});
```

`normalize()`: lowercase, strip everything except `[a-z0-9]`, collapse whitespace. Matching is **exact-token-Set membership** (`Set.has(t)`), not substring — a prior version used `officialNorm.includes(t)`, a raw substring test that let short tokens (`tx`, `ca`, `inc`) spuriously match inside unrelated words (e.g. `"inc"` inside `"increasing"`). Fixed for both fields since they share the matcher.

**Below-bar values are kept, not discarded.** An earlier version of this guard overwrote a below-threshold value with `"Unknown"` — a wrong value never reached the user, but neither did a right one that happened to score low (e.g. the abbreviation-mismatch case below). The product priority here is "some information, possibly wrong" over "no information," matching how every *un*guarded field already behaves (§ below). So instead of discarding, the guard now keeps the extracted value and sets `addressLowConfidence` / `headquartersLowConfidence` on the `CompanyProfile` row; `company-profile-card.tsx` renders a small amber "unverified" badge (with a tooltip explaining why) next to the value rather than hiding it.

| Field | Threshold | Trust set | Why |
|---|---|---|---|
| `address` | ≥70% of tokens | Official-page text only (`officialParts`) | Prompt already restricts `address` sourcing to official pages — the guard's trust set matches that promise exactly. A street address for the wrong company is the single worst failure mode (ADR-013), so this stays the strictest bar even though it's now a flag rather than a wipe. |
| `headquarters` | ≥40% of tokens | Same official-page text (**not** `location`) | `headquarters` has no official-only sourcing restriction in the prompt — legitimate values can come from third-party text (news, LinkedIn) — so a strict 70% bar would flag too much as unverified. The job's own `location` field was deliberately *not* added as a trust source: it's the posting's onsite city, not necessarily HQ (remote/multi-office/branch postings routinely differ), and trusting it would let a same-name collision company's HQ pass just because it coincidentally matches the job's city. |

**Known, accepted limitation**: exact-token matching can flag a *correct* headquarters value low-confidence on an abbreviation mismatch — e.g. `"Austin, TX, USA"` against official text that only spells out `"...Austin, Texas..."` scores 1/3 tokens (`austin` only) ≈0.33, below the 0.4 bar, even though it's right. Not fixed — official contact/about pages tend to give formatted addresses with abbreviations rather than prose, so this is judged rare; the value is still shown (just flagged, not hidden), so the cost of this limitation is lower than it was before the keep-not-discard change. Test-covered (`enrichment.processor.spec.ts`) as deliberate, not accidental.

Every other field (`industry`, `companySize`, `techStack`, `cultureSummary`, `workPolicy`, `workLifeBalance`, `founded`) has **no** deterministic guard — only the prompt-level "don't guess" instruction, and no low-confidence flag either. The user has explicitly accepted some wrong fields as the cost of genuine same-name/different-location company collisions; only the two highest-consequence fields (a literal street address, and to a lesser degree HQ) get the hard check, and both now degrade to "shown but flagged" rather than "hidden."

**Re-run reset** (`EnrichmentService.enqueueEnrichment`): every re-run (including a manual "Refresh" click) nulls all descriptive fields back to `PENDING`, including the two low-confidence flags — a stale `true` flag must not survive onto a `null` field from a fresh run.

## 7. Frontend

**Types** (`frontend/types/index.ts`):
```ts
export type EnrichmentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface CompanyProfile {
  id: string; jobId: string; status: EnrichmentStatus;
  industry?: string; companySize?: string; techStack: string[];
  cultureSummary?: string; workPolicy?: string; workLifeBalance?: string;
  headquarters?: string; headquartersLowConfidence?: boolean;
  address?: string; addressLowConfidence?: boolean;
  founded?: string;
  errorMessage?: string; enrichedAt?: string;
  createdAt: string; updatedAt: string;
}
```
Embedded on `Job.companyProfile?: CompanyProfile` — there's no separate `GET` route for the profile; it comes back as part of `GET /jobs/:id`.

**Polling** (`frontend/app/(dashboard)/jobs/[id]/page.tsx`):
```ts
useQuery<Job>({
  queryKey: ['job', id],
  queryFn: () => api.get(`/jobs/${id}`).then((r) => r.data),
  refetchInterval: (query) => {
    const status = query.state.data?.companyProfile?.status;
    return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
  },
});
```
Polls the whole job every 3s while enrichment is in flight; stops once `COMPLETED`/`FAILED`. No dedicated query key for the profile — it rides along with the job.

**Display** (`frontend/components/company-profile-card.tsx`):

| Status | Shown |
|---|---|
| `profile == null` | Nothing (card doesn't render) |
| `PENDING` / `PROCESSING` | Skeleton card, "Queued…" / "Researching…" — no Refresh button |
| `FAILED` | Header + Refresh button + `classifyFailure(errorMessage)` — pattern-matches into `RATE_LIMITED` / `UNAVAILABLE` / `CONFIG` with tailored copy+icon, falling back to the raw `errorMessage` (or a generic message) if unrecognized |
| `COMPLETED` | Header + Refresh button + all present fields (industry/size/HQ/founded in a grid, deduped tech-stack pills, address, work policy, work-life balance, culture summary) — falsy fields are simply omitted, no "N/A" placeholders |

**Low-confidence badge**: when `headquartersLowConfidence` / `addressLowConfidence` is `true`, the value still renders and gets a small amber "unverified" badge (`AlertTriangle` icon, `title` tooltip explaining it couldn't be confirmed against the company's own site) inline next to it — see `UnverifiedBadge` in `company-profile-card.tsx`. No badge when the flag is `false`/absent, same as any other field.

**Manual retry**: the "Refresh" button (shown on both `FAILED` and `COMPLETED`) calls `POST /jobs/${jobId}/enrichment` and invalidates the `['job', id]` query on success — which both refetches immediately and re-arms the 3s polling interval above (since the profile just flipped back to `PENDING`). A 409 from the backend (already in progress) surfaces as a toast via `getErrorMessage`.

## 8. Full request lifecycle (happy path)

```
User submits "Create Job" form
  → POST /jobs  (JobsService.create)
      → Job row created
      → EnrichmentService.enqueueEnrichment(job.id)   [fire-and-forget, best-effort]
          → CompanyProfile upserted, status: PENDING
          → BullMQ job added to `company-enrichment`
  → 201 response returns immediately — job creation never waits on enrichment

Frontend navigates to job detail page
  → GET /jobs/:id  →  companyProfile.status === 'PENDING'
  → CompanyProfileCard shows "Queued…"
  → useQuery refetchInterval fires every 3s

Meanwhile, in the BullMQ worker:
  EnrichmentProcessor.process(job)
    → status: PROCESSING
    → general Tavily search
    → parallel fetch: job page, homepage, about, contact  (+ /contact-us fallback if needed)
    → conditional domain-scoped fallback search (only if official content thin)
    → assemble two-section context (official, capped 6000 / search, capped 3500)
    → LlmService.extract()  →  Groq tool-call, 30s timeout, one retry on tool_use_failed
    → deterministic guard on address (0.7) and headquarters (0.4) — flags low-confidence, doesn't discard
    → CompanyProfile updated: status COMPLETED, all fields, enrichedAt

Next poll (≤3s later)
  → GET /jobs/:id  →  companyProfile.status === 'COMPLETED'
  → refetchInterval returns false — polling stops
  → CompanyProfileCard renders the researched fields
```

## 9. Known gaps / not solved here

- **No token/cost/latency budget for Groq calls** — prompt size grew (official-section cap 4500→6000) with no discussion anywhere of Groq's own rate limits or cost. Pre-existing gap, not newly introduced, not solved.
- **Non-guarded fields can still cross-contaminate** — `industry`, `culture`, `techStack`, etc. have no deterministic check; a multi-brand/conglomerate homepage could pollute these more than the narrow `/contact`-only fetch used to. Accepted under the user's stated 1-2-wrong-fields tolerance.
- **Headquarters abbreviation mismatch** — see §6's known limitation.
- **Tavily failure is silent** — both the general and domain-scoped search calls return `[]` on any error (bad key, rate limit, network) rather than surfacing a distinct failure state; enrichment continues on page-fetch content alone.

## 10. This PR's decision log

Per-commit rationale for the hardening changes in this PR — decision, problem it solved, side effects accepted.

**`f385122` — `includeDomains` param on `SearchService.search`**
- Decision: add optional `includeDomains` filter, passed through to Tavily's `include_domains`.
- Problem solved: needed a way to scope a search to one domain — prep work, unused until the next commit.
- Side effects: none on its own.

**`597f537` — Homepage + `/about` fetch, domain-scoped fallback search**
- Decision: fetch homepage/`/about` alongside `/contact`; if combined official text <300 chars, fire a 2nd Tavily call scoped to the domain (`includeDomains`).
- Problem solved: `/contact`-only context was too thin for industry/founded/culture fields; some sites block or fail direct fetch (JS-rendered, bot-blocked) even though the domain is legitimate.
- Side effects: doubles Tavily quota usage on the thin-fetch path — mitigated by conditional gating so the common case (direct fetch succeeds) never pays it. More context per LLM call raises cost/latency slightly. Truncation cap raised 4500→6000 to fit the new sources without crowding out contact text (see §4.5 ordering).

**`f18cf82` — Anti-collision guard: substring→exact-token match, address-only→+headquarters**
- Decision: fix `officialNorm.includes(t)` → `officialTokens.has(t)` (exact token-set membership); extend the same guard to `headquarters` with its own looser threshold (0.4 vs address's 0.7).
- Problem solved: the substring check was leakier than intended — false-accepted short tokens like `"inc"` matching inside unrelated words (`"increasing"`). `headquarters` had zero protection before, same same-name-company collision risk as `address` (ADR-013's incident class).
- Side effects: `headquarters` can now false-reject a *correct* value on an abbreviation mismatch (`"Austin, TX"` vs official `"Austin, Texas"` scores 0.33, below the 0.4 bar) — accepted, not fixed, documented in §6's known-limitation note. Net more `"Unknown"` headquarters values in that edge case, traded for fewer wrong ones.

**`32d6280` — `lockDuration: 90_000` on `@Processor`**
- Decision: explicit 90s stall-detection margin (was previously unconfigured/default).
- Problem solved: no protection against a stalled/crashed worker — BullMQ could hand a stuck job to a second worker, duplicating Tavily + Groq spend (a cost bug, not a correctness bug).
- Side effects: none for healthy runs (BullMQ auto-renews the lock at ~45s cadence while the job is alive). Risk: margin shrinks if the pipeline grows slower later (e.g. a 6th data source) — worth revisiting then.

**`41d0d88` — `timeout: 30_000` on the Groq client**
- Decision: hard per-request cap on the LLM call.
- Problem solved: closed the last open-ended step in the pipeline — without it, a hung Groq call could stall the job past the 90s lock margin, causing the exact stall-detection duplicate-run scenario the previous commit was meant to prevent.
- Side effects: a genuinely slow-but-healthy Groq response (transient backend congestion) now hard-fails at 30s instead of eventually succeeding, falling to BullMQ's 2-attempt/10s-backoff retry instead. Slightly more FAILED→retry churn under Groq-side slowness, traded for a closed-form worst-case latency bound.
- **Superseded by the next entry** — the 30s figure turned out not to be closed-form after all (see below).

**Follow-up — `timeout: 45_000` + explicit `maxRetries: 1` on the Groq client**
- Decision: raise the per-request timeout from 30s to 45s, and explicitly pin `maxRetries: 1` instead of leaving `groq-sdk`'s own default (`2`) in place.
- Problem solved: two-part. (1) The product goal is "show some information, possibly wrong" over "no information" (this is the same priority behind §6's low-confidence-flag change) — 45s gives a legitimately slow-but-healthy Groq response more room to land before the pipeline gives up on it and falls back to a full, costlier BullMQ retry. (2) Discovered while sizing the new number: `groq-sdk` retries a client-side timeout internally (`client.js:226-246`) up to `maxRetries` *before* throwing to application code, and the client was never given an explicit `maxRetries` — meaning the true worst-case Groq time under the original `30_000`/default-`2` config was already 30s × 3 = 90s, not the flat 30s §5 previously assumed. Pinning `maxRetries: 1` alongside the new 45s timeout keeps the worst case closed-form (45s × 2 = 90s) instead of leaving it as an unstated multiple of whatever the SDK's default happens to be.
- Side effects: same category as the original entry — a slow call now gets more time to succeed before the whole pipeline retries, at the cost of a slightly higher per-attempt worst-case latency (45s vs 30s per try). `attempts` was deliberately left at BullMQ's existing `2` rather than raised to `3` — a BullMQ-level retry re-runs the entire pipeline (Tavily search + fetches), which would multiply Tavily's free-tier quota usage for a problem this timeout/retry change already addresses more cheaply.
