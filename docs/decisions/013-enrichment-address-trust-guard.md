# ADR-013: Layered trust model with a deterministic guard for enrichment address extraction

## Status
Accepted (partially supersedes ADR-011)

## Date
2026-07-16

## Context
ADR-011 added prompt-based disambiguation (domain + location hints) to company
enrichment and explicitly flagged its weakness: "it depends on the LLM honoring
the prompt instruction, not a hard filter — no guarantee of zero
cross-contamination."

That risk materialized in production. For the company "Innovation Insight"
(innovation-insight.com, Lahore), Tavily results included the contact page of
"Innovation Insights Official" (innovationinsightsofficial.com) — a different
company with a near-identical name **in the same city**. Its street address was
the only address anywhere in the context, and the LLM extracted it into the
profile. Three successive prompt-level mitigations failed to stop this:

1. Instructing the model to abstain on same-name companies — ignored.
2. Tagging each snippet with its source domain (`[title | domain] content`) so
   the model could match sources against the domain hint — ignored.
3. Splitting the context into labeled sections (official site vs. search
   results) and constraining the `address` tool-schema field to the official
   section — ignored.

The location hint from ADR-011 is structurally blind to this case: the wrong
company is in the right city. Root cause: a mid-size model
(llama-3.3-70b) forced to fill a required `address` field will take the only
street address available, regardless of instructions about its source.

## Decision
Keep the prompt-level measures (they improve the other fields) and add a
**deterministic post-extraction guard** for the field that kept failing:

1. **Retrieval hygiene** — quote the company name in Tavily queries; append
   Tavily's synthesized answer last (not first) so its guess cannot dominate;
   tag every snippet with its source domain; dedupe snippets across queries.
2. **Trusted-source expansion** — when the job URL is on the company's own
   domain, also fetch `https://<domain>/contact` and `/contact-us`; place
   contact-page text *before* the homepage so it survives the official-section
   budget cap. Job-board hosts (LinkedIn, Indeed, Glassdoor, Rozee.pk, etc.)
   are never treated as the company's domain — no trust hint, no contact fetch.
3. **Deterministic address guard** (`EnrichmentProcessor`) — after extraction,
   normalize the returned address and require ≥70% of its tokens to appear in
   the text fetched from the company's own pages (official site, contact
   pages, or the job posting). Otherwise the address is forced to `"Unknown"`
   and an `enrichment_address_rejected` log line is emitted.

The guard is scoped to `address` only. Other fields (industry, size, culture)
tolerate fuzzy sourcing; a street address shown for the wrong company is the
single worst failure mode of the feature.

## Alternatives Considered

### Keep iterating on prompt instructions
- Rejected: empirically failed three times in production against the same
  input. Instruction-following cannot be load-bearing for a correctness
  guarantee on this model class.

### Two-pass LLM (relevance filter, then extraction)
- Pros: could filter poisoned snippets for all fields, not just address
- Cons: doubles latency and Groq usage per enrichment; the filter pass is
  itself probabilistic — same failure class, one layer deeper
- Rejected: cost without a guarantee. Revisit if other fields show
  cross-contamination in practice.

### Programmatically drop all snippets not from the company domain
- Re-rejected for the same reason as in ADR-011: Glassdoor/LinkedIn/news
  snippets carry most of the culture/size signal and are legitimately not on
  the company's domain. The guard instead constrains only the one field where
  third-party sources are untrustworthy.

### Larger / better instruction-following model
- Rejected: higher cost, and still probabilistic. A deterministic check is
  strictly stronger for this requirement and free.

## Consequences
- An address now appears in a profile **only** if it is stated on the
  company's own pages. Companies that don't publish an address get
  `"Unknown"` — honest, and verified as the correct outcome for the
  triggering case (innovation-insight.com publishes no address; `/contact`
  is 404).
- Token-overlap matching is fuzzy by design (LLM reformatting of addresses
  survives it), but a legitimate address paraphrased beyond 70% token overlap
  would be wrongly rejected — acceptable trade-off versus showing a wrong
  address.
- Debugging support added: `LOG_LEVEL=debug` logs the full assembled context
  (`enrichment_context`) so retrieval vs. extraction failures can be
  distinguished from logs alone; rejects are visible as
  `enrichment_address_rejected` at info level.
- ADR-011's hints remain in place and unchanged for all non-address fields.
