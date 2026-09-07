# ADR-039: Strip Site Chrome and Prefer Content Landmarks in Web Fetches

## Status
Accepted

## Date
2026-09-06

## Context
`WebFetchService.fetchPageText` extracted whole-`<body>` text after removing
only `<script>`, `<style>` and `<noscript>`, then truncated the result to
`LLM_CONTEXT_BUDGET` (8000 characters). Navigation menus, cookie banners,
newsletter forms and footers therefore competed with real page content for the
same budget — and, being markup-early, won.

Measured against three Pakistani IT companies of the kind this app tracks:

| Site | whole `<body>` | chrome stripped, `<main>` preferred |
| --- | --- | --- |
| systemsltd.com | 12883 | 6089 |
| innovation-insight.com | 5410 | 5255 |
| netsoltech.com | 245 | 176 |

On systemsltd.com, 6794 of 12883 characters were the navigation menu, and the
page's own positioning prose ("Leading change through AI-native technology…")
began only after roughly 700 characters of `Skip to main content / Main
navigation / Services / Digital / …`. Because the page exceeded the 8000
character per-page budget, that boilerplate crowded the front of the LLM
context *and* pushed real content past the cut. After stripping, the whole page
fits inside the budget with nothing truncated at all.

This is the second of the two causes identified while investigating weak
company profiles. ADR-038 fixed the first — the assembled context discarded the
homepage entirely — but raising a budget does not help when the content filling
it is menu text.

## Decision
In `fetchPageText`, before extracting text:

1. Remove `nav, header, footer, aside, form` in addition to
   `script, style, noscript`.
2. Prefer the page's own content landmark: `$('main').text()`, else
   `$('article').text()`, else the stripped `<body>`.
3. If the stripped result is empty, fall back to un-stripped `<body>` text.

`header` is included deliberately. On innovation-insight.com the entire
navigation lives inside `<header>`, and removing it was what surfaced the
company's actual tagline; no measured site lost hero copy to it.

The empty-result fallback keys on emptiness, not on length. A length comparison
would always prefer the un-stripped text — boilerplate makes it longer by
construction — which is the opposite of the point.

## Alternatives Considered

### Strip everything except `header`
- Pros: guards against sites that put hero copy inside `<header>`.
- Rejected: measured, not assumed. On the three sites tested, keeping `header`
  either changed nothing (systemsltd.com, netsoltech.com) or left the full
  navigation in place (innovation-insight.com). No site lost content to it.

### A readability/boilerplate-removal library (e.g. `@mozilla/readability`)
- Pros: better extraction, tuned on real pages.
- Rejected for now: a new dependency needs a bundle/necessity check per
  CLAUDE.md, and it is tuned for articles rather than marketing homepages —
  which is what enrichment actually fetches. Revisit if selector-based
  stripping proves insufficient.

### Raise `LLM_CONTEXT_BUDGET` instead
- Rejected: more boilerplate is not more signal, and it raises Groq cost for
  every fetch. Density is the problem, not the ceiling.

## Consequences
- Text per page drops sharply (12883 → 6089 on systemsltd.com) while the
  information in it goes up. Pages that previously overflowed the 8000
  character per-page budget now fit whole.
- Content-bearing markup that a site wrongly wraps in `<nav>` or `<aside>` is
  now lost. Judged acceptable: the fields extracted here (`industry`,
  `companySize`, `techStack`, `cultureSummary`, `workPolicy`) come from body
  prose, not from chrome.
- The `< 300` character gate in `CompanyEnrichmentProcessor` that fires the
  domain-scoped fallback search now measures denser text, so a page can drop
  below it that previously cleared it on boilerplate alone. That is the gate
  working as intended, but it can shift Tavily quota use — watch it against
  ADR-035.
- JS-rendered sites are unaffected and still fail. netsoltech.com returns 176
  characters of SPA shell because cheerio executes no JavaScript. Fixing that
  needs a headless browser and is out of scope here.
