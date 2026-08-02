# ADR-002: Anthropic Claude with tool_use for structured company extraction

## Status
Superseded by [ADR-007](./007-groq-llm-migration.md)

## Date
2026-06-12

## Context

The enrichment pipeline receives unstructured text (Brave Search snippets, scraped
website content) and must produce a consistent JSON object:

```
{ industry, companySize, techStack[], cultureSummary, remotePolicy,
  workLifeBalance, headquarters, founded }
```

The key requirements are:
1. **Guaranteed structure** — the extraction must always yield a valid object with
   predictable field names and types, not a free-form string.
2. **Graceful degradation** — when information is absent in the source text the
   model should use `"Unknown"` / `[]`, not hallucinate.
3. **Speed and cost** — the enrichment runs on every new job; slowness or high cost
   at scale defeats the feature's purpose.

## Decision

Use **Anthropic Claude Haiku** (`claude-haiku-4-5-20251001`) with **`tool_use`** and
`tool_choice: { type: 'any' }`.

A single tool `extract_company_data` is defined with a full JSON Schema describing
every output field (including `enum` constraints for `companySize`, `remotePolicy`,
`workLifeBalance`). Setting `tool_choice: { type: 'any' }` forces the model to
always call the tool — the response is always a `tool_use` block, never free text.

The response is then passed through a `sanitize()` function that validates each
field's runtime type before saving to the database, guarding against the model
returning `null` for required fields.

### Why tool_use over JSON mode
JSON mode (available via `response_format: { type: 'json_object' }` in some
providers) asks the model to produce JSON but doesn't enforce a schema. The output
can be valid JSON with unexpected field names, missing keys, or wrong types. `tool_use`
enforces the exact schema at the API level: field names, required fields, and enum
values are validated by the provider before the response is returned.
`tool_choice: 'any'` additionally guarantees the tool is called — no risk of the
model responding with a refusal or prose instead.

### Why Claude Haiku specifically
- **Cost:** Haiku is the cheapest Anthropic model by input/output token. For a
  portfolio app where every job triggers an API call, this matters.
- **Speed:** Haiku returns in 2–5 s; larger models (Sonnet, Opus) take 15–30 s and
  would make the polling UX feel slow.
- **Capability:** Structured extraction from provided text is not a reasoning-heavy
  task; Haiku is sufficient.
- **Future upgrade path:** the model is a one-line constant; switching to Sonnet is
  trivial if extraction quality needs improvement.

## Alternatives Considered

### OpenAI GPT-4o-mini with function calling
- **Pros:** Equivalent structured-output capability; competitive pricing.
- **Cons:** Anthropic's `tool_use` API shape is preferred (personal familiarity);
  no meaningful capability difference for this task.
- **Not rejected on principle** — could swap in with ~20 lines of change.

### Prompt engineering to extract JSON from prose
- **Pros:** No dependency on tool_use API; works with any model.
- **Cons:** Requires parsing and validating the output string. Models hallucinate
  structure, produce trailing text, or include markdown code fences. Fragile.
- **Rejected:** `tool_use` is strictly more reliable for guaranteed JSON output.

### Specialised company data APIs (Clearbit, Apollo.io, LinkedIn)
- **Pros:** Accurate, structured data with no LLM uncertainty.
- **Cons:** All require paid plans or impose strict free-tier limits (Clearbit:
  discontinued free tier; Apollo: email-enrichment focus; LinkedIn: no public API).
  Require real, normalised company names — user input is free-form.
- **Rejected:** Cost and robustness constraints.

### Local LLM (Ollama on the Oracle VM)
- **Pros:** No API key; no per-call cost.
- **Cons:** Oracle Always Free A1 shape has 1 OCPU and 6 GB RAM. Running a capable
  7B+ model would starve the API server of memory. Inference speed on CPU would be
  minutes per job.
- **Rejected:** Hardware constraint.

## Consequences

- `ANTHROPIC_API_KEY` is required for enrichment (optional in Joi schema — the app
  starts without it, but enrichment jobs will fail with FAILED status).
- The `sanitize()` function in `LlmService` provides a defence-in-depth layer: even
  if the model violates its own schema contract, the application won't crash or store
  malformed data.
- The `LLM_CONTEXT_BUDGET` constant (8,000 characters) caps the context passed to
  Claude, limiting token cost and preventing prompt injection via oversized scraped
  pages.
- SSRF risk: the web-fetch step fetches a URL from the job record (user-supplied).
  `WebFetchService.isSafeUrl()` blocks private IPs and non-HTTP protocols before
  any network call is made (see ADR-001 for the pipeline context).
