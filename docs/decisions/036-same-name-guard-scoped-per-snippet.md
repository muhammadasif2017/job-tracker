# ADR-036: Scope the Same-Name Guard to Individual Snippets

## Status

Accepted. Amends the prompt half of [ADR-011](./011-enrichment-search-disambiguation.md);
the deterministic guards from [ADR-013](./013-enrichment-address-trust-guard.md)
are unchanged and are what make this safe.

## Date

2026-09-04

## Context

Company enrichment was completing successfully and writing `null` to every
column. The UI rendered "Unknown" for industry, size, HQ, founded, address,
work policy, work-life balance and culture — on every company added by
creating a job.

The runs were healthy: `company_enrichment_started` → `company_enrichment_completed`
in ~4s, no `tavily_search_error`, no `web_fetch_error`, no retries. Search was
returning results and the LLM was returning a well-formed tool call. It was
simply answering "Unknown" to everything.

Reproduced locally at `LOG_LEVEL=debug`, which logs the full extraction
context (`company_enrichment_context`). For the company "Codenzy", Tavily
returned six snippets. One was unambiguously right:

```
[Codenzy - Code Your Future Today | codenzy.com] US-based B2B software
engineering. 48+ Projects Delivered 20+ Expert Engineers 95% Client
Retention 5+ Years in Business. Contact 52B, 2nd floor, Dr Gulraiz Rd
```

along with a `[Summary]` restating the same facts. The other five described
*different* companies that merely share part of the name — Coder, Codenza
Technologies, Code Corporation, CodeNinja.

The extraction prompt ended with:

> If the content describes a different company that merely shares the name
> "X", return "Unknown" for all string fields and [] for arrays rather than
> extracting from it.

That sentence was written to mean "if **all** the content is about a different
company." The model read it as "if **any** of it is." Since a small company's
search results almost always contain a few same-named businesses, the guard
fired on essentially every run and discarded the good snippets along with the
bad ones. The better the search coverage, the more likely it was to trip.

Two things made this hard to notice. The run reports success, because
returning "Unknown" *is* a valid extraction — `sanitize` maps the literal
string to `null` (`llm.service.ts`), and `buildCompletedProfileData` writes
`data.industry ?? previous.industry`, so null over null is a no-op rather than
an error. And nothing logs the extracted values, only the duration.

A second, compounding problem: `JobsService.resolveCompanyId` auto-creates the
`Company` row with only `{ userId, name, city: OTHER }`. With no `websiteUrl`
there is no official-site fetch at all, so context is search snippets alone —
and with no `location` there is no disambiguation hint either. The model was
being asked to separate a real company from its same-named neighbours with
nothing to anchor on, and then told to discard everything if it couldn't.

## Decision

1. **Scope the same-name guard per snippet.** Ignoring a snippet about a
   different company means skipping *that snippet*, not abandoning the
   extraction. All-"Unknown" is returned only when NONE of the content is
   about the target company. The prompt now says so explicitly, and names the
   mixed-results case as the expected shape rather than an error condition.

2. **Seed the job's location onto the auto-created company.**
   `resolveCompanyId` takes the location and writes it at creation, restoring
   the ADR-011 location hint for companies that arrive via job creation.
   Creation only — it must never overwrite a location the user has since
   corrected on an existing company.

## Why this doesn't reopen what ADR-011 and ADR-013 closed

ADR-011's concern was extracting data about the wrong company. That risk is
still covered, by mechanisms this change does not touch:

- The per-snippet source prefix (`[title | domain]`) that lets the model judge
  each snippet's origin.
- The domain and location disambiguation hints — **strengthened** here, since
  auto-created companies previously had neither.
- The `OFFICIAL COMPANY WEBSITE` / `WEB SEARCH RESULTS` section split, with
  search results explicitly labelled as possibly describing other companies.
- ADR-013's deterministic token-overlap guard on `address` and `headquarters`,
  which scores extracted values against official-site text and flags
  low-confidence ones. This is the real backstop, and it is untouched.

Verified in the reproduction: after the change, `address` still comes back
`null`, because the `EXTRACT_TOOL` description forbids taking an address from
web search. The loosening did not leak past the deterministic guard.

## Alternatives Considered

### Programmatically drop snippets whose domain doesn't match the company

Rejected for the same reason ADR-011 rejected it: most useful context
(Crunchbase, LinkedIn, Glassdoor, news) is not on the company's own domain, so
filtering by domain discards nearly everything.

### Ask for a per-field confidence score and drop low-confidence fields

More machinery than the problem needs, and it moves the same judgement call
into a number the model is no better at producing. ADR-013's deterministic
overlap check already covers the two fields where a wrong value actually
hurts.

### Leave it and set `websiteUrl` on auto-created companies instead

Doesn't work: the job posting URL is usually a job board (LinkedIn, Indeed,
Rozee), which `extractDomain` deliberately rejects via `JOB_BOARD_DOMAINS`.
There is no reliable company domain available at job-create time.

## Consequences

- Enrichment populates fields for companies whose search results are mixed —
  in practice, most small or regionally-named employers. Verified against a
  live run: industry, company size, founded and headquarters all went from
  `null` to correct values on identical search input.
- Slightly higher risk of a wrong-company value in a *non*-guarded field
  (industry, culture, work policy) when search returns nothing genuine and the
  model attributes an impostor snippet anyway. Accepted: those fields are
  advisory, the user can edit them, and the previous behaviour — discarding
  correct data on nearly every run — was strictly worse.
- Companies created before this change keep their empty profiles until
  re-enriched. Refresh is the recovery path; ADR-035's gate deliberately does
  not re-run them automatically.
- `resolveCompanyId` takes a third parameter. The update path at
  `JobsService.update` deliberately does not pass one — a company rename
  should not re-seed a location.
- Three regression tests: two asserting the location seeding (set when
  present, absent rather than empty-string when not), one asserting the prompt
  conditions all-"Unknown" on NONE of the content matching. The prompt test
  asserts on wording, which is brittle by nature, but the failure it guards
  against is silent and expensive to rediscover.
