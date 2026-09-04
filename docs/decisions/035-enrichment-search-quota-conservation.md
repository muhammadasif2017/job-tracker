# ADR-035: Conserve Tavily Search Quota in Company Enrichment

## Status

Accepted

## Date

2026-09-04

## Context

Company enrichment burned through Tavily's 1,000 req/month free tier
(ADR-001) far faster than the actual volume of distinct companies justified.

There are only three Tavily call sites in the codebase:

1. `CompanyEnrichmentProcessor` — the general company query, fired on every run.
2. `CompanyEnrichmentProcessor` — the same query again with
   `include_domains: [domain]`, fired when the official-site fetch returned
   under 300 characters.
3. `JobParsingService` — the Quick Add fallback, fired only when the page
   fetch and LLM extraction both failed.

So one enrichment run costs 1–2 search calls, doubled by the queue's
`attempts: 2` retry policy — up to 4 per run.

Three things multiplied that cost without buying any information:

**Re-enrichment per job, not per company.** `JobsService.create` called
`enqueueEnrichment` unconditionally for the resolved company. The comment
above that call claimed "one AI research run per company, not duplicated per
job at that company" (from `docs/specs/company-fk-phase3b.md`), but nothing
enforced it. Adding the fifth job at a company already enriched weeks ago
re-ran the whole pipeline to rediscover facts already in the row. A user
tracking N applications at one employer paid N times over.

**No claim on the auto path.** `CompaniesService.triggerEnrichment` (the
Refresh button) guards itself with a compare-and-swap `updateMany`;
`enqueueEnrichment` had no equivalent, so a burst of job creations at one new
company queued one run per job.

**Retrying an account-level failure.** When search returned 429/432 (quota) or
401/403 (bad key) and there was no official-site content to fall back on, the
run threw an ordinary `Error`. BullMQ retried 10 seconds later, spent another
search call, and got the identical failure. Worse, within a single attempt the
`include_domains` fallback still fired after the general search had already
been rejected for quota — a guaranteed-wasted second call on exactly the runs
where quota was the problem.

## Decision

Add `CompanyEnrichmentService.enqueueIfStale(companyId)` and use it — not
`enqueueEnrichment` — from `JobsService.create`.

`enqueueIfStale` is a single `updateMany` that serves as both the staleness
gate and the CAS claim:

```ts
where: { id: companyId, status: null, enrichedAt: null }
data:  { status: PENDING, errorMessage: null }
```

`count === 0` means there is nothing to do, and nothing is queued. That one
predicate covers every skip case:

- **COMPLETED** — the profile is already on the row.
- **PENDING/PROCESSING** — a run already owns it; this is what collapses a
  burst of job creations into one run.
- **FAILED** — see "Failed companies" below.

`enqueueEnrichment` keeps its unconditional behavior and stays the sole path
for `CompaniesService.triggerEnrichment` (the Refresh button) and for
`CompaniesService.create`, where a just-created row can never be gated anyway
and the method mirrors `status: PENDING` into its own response.

In `CompanyEnrichmentProcessor`:

- The `include_domains` fallback search is skipped when
  `searchUnavailableReason` is already set.
- A run that ends with no context *because* search was unavailable throws
  BullMQ's `UnrecoverableError` instead of `Error`, so the second attempt is
  skipped. The message is unchanged, so ADR-031's frontend `RATE_LIMITED` and
  `CONFIG` classifiers still see exactly what they expect. The two
  "No extractable content" cases stay ordinary retryable `Error`s — a site
  that was down or a search that genuinely found nothing can differ on the
  next attempt.

## Failed Companies

`enqueueIfStale` deliberately does **not** re-run a company whose last
enrichment FAILED.

A company that cannot be enriched — no website on file and no useful search
hits, which is the common shape for small or obscure employers — would
otherwise re-burn 1–2 search credits on every single job added at it, forever,
always to fail the same way. That is the worst case for a quota this ADR
exists to protect.

The cost is that a *transient* failure (a network blip, a Groq 5xx) no longer
self-heals on the next job add. That is acceptable because recovery is one
click: `CompanyProfileCard` already renders a prominent Refresh button on a
failed profile, and Refresh goes through the ungated `enqueueEnrichment`.

## Alternatives Considered

### Time-based cooldown instead of skipping FAILED outright

Retry a failed company only if the last attempt was more than N hours ago.
Rejected: `Company` has no "last attempted" timestamp — `enrichedAt` is only
written on success and `updatedAt` moves whenever the user edits any field, so
neither can carry the cooldown. A new column means a migration, which this
change does not otherwise need.

### Drop the general search and rely on the official-site fetch

Rejected: quality loss. `cultureSummary`, `workLifeBalance` and `techStack`
come from third-party and review pages, not the company's own site, and the
official text is the trust anchor the address/headquarters confidence guard
scores against (ADR-013).

### Reduce `max_results` or turn off `include_answer`

Deferred, and not verified. Tavily bills per search call, and this change cuts
call *count* directly: a job added at an already-enriched company goes from 1–4
search calls to zero. Per-call tuning is a multiplier on a term that just
shrank. Any change here should be made against Tavily's current published
credit costs rather than assumption — none of the numbers in this ADR came
from the billing dashboard.

### Deriving the domain-filtered snippets from the first search's results

Have `SearchService.search` return structured `{url, title, content}` so the
processor can filter the general search's results by hostname and skip the
second call when it already has coverage of that domain. This is the right
long-term fix and is genuinely lossless, but it changes the service's public
shape and both of its callers. Left for a separate change.

## Consequences

- A company enriches once. Re-enrichment is a deliberate user action.
- `JobsService.create`'s best-effort try/catch contract is unchanged — an
  enqueue failure still never fails job creation.
- `enqueueIfStale` releases its claim (status back to `null`) if `queue.add`
  throws. Without that, a Redis outage would leave the row at PENDING with
  nothing queued, which `enqueueIfStale` skips *and* `triggerEnrichment`'s CAS
  rejects with a 409 — the company would be permanently unenrichable. The
  status update must stay ahead of the enqueue (a worker picking the job up
  immediately would otherwise have PROCESSING clobbered back to PENDING), so
  rollback is the fix rather than reordering.
- `enqueueEnrichment` has the same window and does **not** roll back: it
  cannot, since it doesn't know which status it overwrote. A `queue.add`
  failure there (reachable from `CompaniesService.create`, whose caller
  catches and logs it) strands the row at PENDING. Pre-existing and left
  alone; worth fixing if it is ever observed in practice.
- No `schema.prisma` change and no migration; `status` and `enrichedAt`
  already existed.
- `jobs.service.spec.ts` now mocks `enqueueIfStale`. Note the mock is typed
  `satisfies Pick<CompanyEnrichmentService, 'enqueueIfStale'>`, so renaming
  the method again will fail the type check rather than silently pass.
- `frontend/e2e/company-enrichment.spec.ts` creates one job per test against a
  single shared user and a fixed company name (`Enrich Co`), so from the
  second test onward the company is no longer fresh and enrichment is skipped.
  All of its assertions accept a terminal state (they key off the Refresh
  button, which COMPLETED and FAILED both render), so the suite still passes —
  but a future test there that *requires* seeing PENDING after a job create
  must use a fresh company name.
- Still unaddressed, in rough order of remaining value: a Redis circuit
  breaker in `SearchService` on 429/432 so one quota rejection short-circuits
  the other two call sites; caching search responses in Redis keyed by query
  (company facts move slowly, so a long TTL is safe and makes re-runs and
  Refresh free); and the structured-results refactor described above.
