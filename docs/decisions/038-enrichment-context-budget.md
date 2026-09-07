# ADR-038: Drop Contact-Page Fetches and Raise the Enrichment Context Budgets

## Status
Accepted (partially supersedes ADR-013)

## Date
2026-09-06

## Context
Company enrichment produced weak profiles — `industry`, `companySize`,
`techStack`, `cultureSummary` and `workPolicy` frequently came back `Unknown`
or `[]` for companies whose websites plainly state those facts. The search
provider was not the cause: the pipeline discarded content before the LLM ever
saw it.

`CompanyEnrichmentProcessor` assembled its official section as:

```ts
officialParts = [...contactTexts, aboutText, homepageText, ...domainSnippets]
sections.push(`=== OFFICIAL COMPANY WEBSITE (${domain}) ===\n${officialParts.join('\n\n').slice(0, 6000)}`)
```

Two problems compounded:

**Contact text was first, and worthless.** `WebFetchService.fetchPageText`
returns up to `LLM_CONTEXT_BUDGET` (8000) characters per page, so contact plus
about routinely exceeded the 6000-character cap on their own and the homepage —
where a company states what it does — never reached the model at all. The
ordering came from ADR-013, which put contact text first so a street address
would survive the budget. That rationale expired: `address`, `headquarters` and
their `*LowConfidence` flags were dropped in #283, along with the deterministic
token-overlap guard that consumed them, and `CompanyProfile` itself was dropped
in #193. No field written by `buildCompletedProfileData` derives from contact
content. The two fetches (`/contact`, plus a serial `/contact-us` fallback)
were pure cost — two of four HTTP requests inside a 90s BullMQ `lockDuration` —
and their only observable effect was evicting the homepage.

**The budgets were far below the model's limit.** 6000 characters of official
text plus 3500 of search results capped the entire prompt at roughly 9500
characters — about 2.4k tokens into `openai/gpt-oss-120b`. The budget, not the
model, was the binding constraint. The 3500-character search cap also silently
defeated `SearchService`, which appends Tavily's synthesized `[Summary]` last
on purpose (ADR-013 §1 retrieval hygiene): being last, it was the first thing
truncated away.

## Decision
1. Stop fetching `/contact` and `/contact-us`. Official content is the homepage
   and `/about` only, fetched in parallel.
2. Order the official section homepage-first, then `/about` — highest-signal
   content is now the last to be crowded out.
3. Raise the section budgets to named constants: `OFFICIAL_SECTION_BUDGET`
   16000 and `SEARCH_SECTION_BUDGET` 8000. 16000 admits a full homepage and
   `/about` at `LLM_CONTEXT_BUDGET` each; 8000 admits all five Tavily snippets
   plus the `[Summary]`.

The `< 300` character threshold that gates the domain-scoped fallback search is
unchanged, and still measures the same official text — now homepage plus about
rather than contact plus about plus homepage.

## Alternatives Considered

### Replace or self-host the search provider
- Considered first, since the symptom looked like poor retrieval.
- Rejected: the content was already arriving. A new provider, or a self-hosted
  SearxNG, would have fed the same truncation. Building an index (crawl, store,
  rank) is out of scope for this project by an order of magnitude.

### Keep the contact fetches but move them last
- Pros: preserves an ADR-013 source in case an address field returns.
- Rejected: the fetches cost latency inside the worker lock and produce text
  that no current field can consume. Re-add them with the field, if it returns.

### Raise the budgets without reordering
- Pros: single-line change.
- Rejected: leaves nav/contact boilerplate ahead of the homepage, so it only
  raises the truncation point rather than fixing what gets truncated.

### Add new sources (Wikipedia/Wikidata, `/careers`, job descriptions in the DB)
- Deferred, not rejected. Worth doing once the plumbing stops discarding what
  it already has; `techStack` in particular is better served by the job
  descriptions already stored than by any company homepage.

## Consequences
- Enrichment makes 2 HTTP fetches per run instead of up to 4, both parallel —
  the serial `/contact-us` round-trip is gone from the `lockDuration` budget.
- Prompt size per extraction call can roughly double in the worst case
  (~9500 → ~24000 characters). Groq cost and latency rise accordingly; the 45s
  client timeout and `maxRetries: 1` in `LlmService` are unchanged and still
  bound the worker's worst case at 90s.
- Tavily quota use is unaffected — no query count or `max_results` changed, so
  ADR-035's conservation work still holds.
- ADR-013's contact-first ordering and contact-page fetching are superseded.
  Its other measures (quoted queries, summary-last, per-snippet source tags,
  dedupe) remain in force.
- If profiles are still thin after this, the next causes to check are
  `WebFetchService` extracting whole-`<body>` text (nav, cookie banners and
  footers compete with real content) and JS-rendered sites returning nothing to
  cheerio. Both are separate changes.
