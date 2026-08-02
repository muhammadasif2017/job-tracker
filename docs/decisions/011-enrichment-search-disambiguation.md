# ADR-011: Disambiguate company enrichment search by domain and location

## Status
Partially superseded by ADR-013 — prompt hints alone proved insufficient for
the `address` field; a deterministic guard now backs them. Hints remain active
for all other fields.

## Date
2026-07-07

## Context
Company enrichment (`EnrichmentProcessor`) searched Tavily using only the
company name (`"${company} company overview headquarters founded employees
industry"`). Many company names collide across regions — a local company and
an unrelated global company can share the same name. With no anchor beyond
the name, search results and the resulting LLM extraction could describe the
wrong company entirely (e.g. a Pakistan-based local business instead of the
actual employer from the job posting).

Separately, `CompanyProfile` had a `headquarters` field (city/region) but no
full street address, which users want to see for the actual employer.

## Decision
1. Add `CompanyProfile.address` (full postal address), extracted via the same
   `EXTRACT_TOOL` schema used for `headquarters`, `industry`, etc.
2. Append `job.location` (when present) to both Tavily search queries, to
   narrow results geographically.
3. Extract the hostname from `job.url` (when present) and pass it, along with
   `job.location`, to `LlmService.extract()` as a `disambiguation` hint. The
   hint is injected into the extraction prompt, explicitly instructing the
   model to only use content matching that domain/location and to ignore
   snippets describing unrelated same-named companies.

## Alternatives Considered

### Programmatically filter search results by domain match
- Pros: deterministic, no reliance on LLM instruction-following
- Cons: many legitimate sources (Crunchbase, LinkedIn, Glassdoor, news) won't
  be hosted on the company's own domain — filtering by domain would drop most
  useful context
- Rejected: too brittle, would gut the context available to the LLM

### Rely solely on `job.url` page content, drop generic web search
- Pros: no ambiguity — the job posting itself is unambiguous
- Cons: most job postings don't contain rich company background (culture,
  tech stack, funding, HQ, address) — this was the reason web search exists
- Rejected: would regress data quality for the majority of fields

### Do nothing
- Rejected: name collisions directly produce incorrect data shown to users
  evaluating a company, undermining trust in the whole enrichment feature

## Consequences
- Disambiguation is best-effort: it depends on the LLM honoring the prompt
  instruction, not a hard filter — no guarantee of zero cross-contamination.
- Jobs missing both `url` and `location` get no improvement (same behavior as
  before).
- `address` reuses the existing sanitize/"Unknown" fallback pattern, so no
  new failure modes for missing data.
