# ADR-029: Job creation reuses a matched target company's completed enrichment instead of re-fetching

## Status
Accepted

## Date
2026-08-15

## Context

Two enrichment pipelines exist side by side, by deliberate design
(`docs/specs/target-companies.md` Assumption 2 / ADR-003):

- **Job-scoped**: `CompanyProfile` (1:1 with `Job`), populated by
  `EnrichmentService` via a Tavily search + Groq LLM extraction, auto-enqueued
  on every `POST /jobs`.
- **Company-scoped**: fields directly on `Company` (target companies feature),
  populated by the parallel `CompanyEnrichmentService`/`company-enrichment.processor.ts`,
  auto-enqueued on `POST /companies` and on-demand via `POST /companies/:id/enrichment`.

`JobsService.create` already computes a soft, non-persisted `matchedCompany`
link (case-insensitive name match against the user's target companies) purely
to render a "you already saved this company" banner — it was never used to
affect enrichment behavior.

The result: adding a job for a company you've already researched as a target
company paid for a second full Tavily+Groq round trip to re-derive data
already sitting on the matched `Company` row, even when that data was
complete and unlikely to have changed.

## Decision

When `JobsService.create` finds a case-insensitive `matchedCompany` whose
`status` is `EnrichmentStatus.COMPLETED`, it copies that company's
enrichment fields (industry, companySize, techStack, cultureSummary,
workPolicy, workLifeBalance, headquarters(+lowConfidence),
address(+lowConfidence), founded, enrichedAt) directly into a new
`CompanyProfile` row for the job, with `status: COMPLETED`, and **skips**
`EnrichmentService.enqueueEnrichment` entirely — no queue job, no external
API calls.

If there's no match, or the match exists but isn't `COMPLETED` yet (never
enriched, still `PENDING`/`PROCESSING`, or `FAILED`), behavior is unchanged:
`enqueueEnrichment` runs as before.

The copy is best-effort, same contract as the enqueue path it replaces — a
failure to write `CompanyProfile` logs a warning and does not fail job
creation.

The user still controls freshness: `CompanyProfileCard` (frontend) renders a
"Refresh" button whenever `profile.status === 'COMPLETED'`, which was already
true before this change (it's the same button used for a normal re-run) — so
a copied profile is refreshable exactly like an organically-enriched one,
via `POST /jobs/:id/enrichment`. No new UI or endpoint was needed.

## Alternatives Considered

### Option A: Skip enrichment entirely, leave CompanyProfile unset

Don't auto-fetch at all when a completed match exists; require the user to
manually trigger job enrichment if they want the data attached to the job.

- **Pros:** Simplest change — one `if` around the existing enqueue call.
- **Cons:** The job detail page would show nothing until the user notices
  and clicks Research, even though the data was one query away. Defeats the
  actual goal (surface data you already have) in favor of only avoiding
  re-fetching it.
- **Rejected:** the point of "connecting" the two features is that having
  the data already means the job should show it, not that it should show
  nothing.

### Option B: Generalize the two enrichment pipelines into one

Point `EnrichmentProcessor` at `Company` rows too, so there's a single
enrichment implementation shared by both `Job` and `Company`.

- **Pros:** Removes the duplication that `docs/specs/target-companies.md`
  Assumption 2 already flagged as a known tradeoff.
- **Cons:** Out of scope for what was asked, a much larger and riskier
  change (queue names, processor branching on entity type, migration of
  both `CompanyProfile` and `Company` enrichment columns), and explicitly
  deferred by the target-companies spec ("keep `EnrichmentProcessor`/
  `CompanyProfile` untouched per Assumption 2").
- **Rejected:** a data-reuse copy at creation time gets the requested
  behavior (skip a redundant fetch, respect user's choice to refresh)
  without touching either pipeline's internals. Revisit only if pipeline
  duplication itself becomes a maintenance problem.

### Option C: Add a `force` flag to gate the copy behind an explicit request

Require the frontend to opt in (e.g. `POST /jobs?reuseCompanyData=true`)
rather than defaulting to reuse.

- **Cons:** The default the user asked for is "reuse if we have it" — making
  that opt-in inverts the ask and adds a parameter with no other consumer.
- **Rejected:** reuse-by-default with an existing, un-gated way to force a
  fresh fetch (the Refresh button) already satisfies "up to the user."

## Consequences

- A job created against an already-researched target company gets an
  instantly-populated Company Profile card with no wait and no external API
  cost.
- `matchedCompany` in the `POST /jobs` response is unchanged in shape
  (`{ id, name }`) — this is purely a side effect of the match, not a new
  field. No frontend type or component changes were required.
- `CompanyProfile.enrichedAt` on a copied profile reflects when the target
  company was originally researched, not the job's creation time — this is
  intentional (the UI's "last known good" framing depends on it being a real
  research timestamp, not a copy timestamp).
- The company's own re-enrichment (`POST /companies/:id/enrichment`) is
  untouched by this change — it still always re-fetches and overwrites on
  every trigger, gated only by the frontend's confirm dialog (spec
  Assumption 9). Scoped out of this decision; revisit separately if needed.
- `EnrichmentProcessor` and `company-enrichment.processor.ts` remain fully
  separate, per ADR/spec precedent — this change only adds a read-time copy
  at job-creation, it does not merge the pipelines.
