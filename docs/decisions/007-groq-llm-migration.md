# ADR-007: Migrate LLM extraction from Anthropic Claude to Groq

## Status
Accepted — supersedes [ADR-002](./002-llm-tool-use-extraction.md)

## Date
2026-06-14

## Context

ADR-002 chose Anthropic Claude Haiku for structured company extraction, citing cost
and speed. That decision was sound, but two constraints emerged after the initial
implementation:

1. **Free tier exhausted.** The Anthropic free tier is small and shared with other
   usage. Once it runs out, enrichment fails silently (the job stays in `FAILED`
   status with no useful error). For a portfolio project on Oracle Always Free
   infrastructure, paying per-call is not acceptable.

2. **Errors were swallowed.** `LlmService.extract()` caught all exceptions and
   returned a fallback `UNKNOWN_DATA` object. This meant enrichment appeared to
   succeed (status → `DONE`) even when the LLM call failed entirely, hiding API
   key problems, rate limits, and network errors. The job tracker UI would show
   enriched data as all "Unknown" with no indication that enrichment had actually
   failed.

A third improvement was bundled in: the Tavily search queries were generic
(`company culture reviews`, `tech stack engineering`) and the response body
discarded Tavily's synthesised `answer` field and result titles — throwing away
the highest-signal content.

## Decision

### 1. Switch LLM provider to Groq

Replace `@anthropic-ai/sdk` with `groq-sdk` and model `claude-haiku-4-5-20251001`
with `llama-3.3-70b-versatile`.

Groq's free tier is substantially more generous for a low-volume portfolio app.
The tool-calling interface is OpenAI-compatible (`tool_choice: 'required'` replaces
Anthropic's `tool_choice: { type: 'any' }`); the tool schema shape changes from
Anthropic's `input_schema` to OpenAI-style `function.parameters`. The `sanitize()`
defence layer is preserved unchanged.

Environment variable `ANTHROPIC_API_KEY` → `GROQ_API_KEY`.

### 2. Rethrow LLM errors; propagate to processor

`LlmService.extract()` now re-throws on failure instead of returning `UNKNOWN_DATA`.
`EnrichmentProcessor` already updates `CompanyProfile.status` to `FAILED` in its
catch block — so genuine failures now correctly land in `FAILED` state rather than
`DONE` with all-Unknown fields.

The processor's nested `catch` (guarding the `prisma.companyProfile.update` inside
the error handler, which can throw if the profile was cascade-deleted) now logs a
warning and re-throws the original error, rather than silently swallowing it.

### 3. Improve search context

Search queries changed to surface overview information as well as culture/tech data:

- `${company} company overview headquarters founded employees industry`
- `${company} engineering tech stack remote work culture glassdoor`

Tavily's `include_answer: true` flag is added. The synthesised answer (highest-signal
summary) is prepended to the snippet list. Result titles are prepended to each
snippet (`[Title] content`) so the LLM has source attribution to reason against.

## Alternatives Considered

### Keep Anthropic, add a paid account
- **Pros:** No code change; familiar API.
- **Cons:** Ongoing cost on a portfolio project with no revenue. Defeats the
  "stay within Oracle Always Free" constraint from the deployment decision.
- **Rejected:** Cost constraint.

### OpenAI GPT-4o-mini
- **Pros:** Competitive free tier; function-calling is well-tested.
- **Cons:** Free tier is also limited; adds another vendor for no capability gain.
- **Rejected:** Groq is faster on inference and has a larger free quota for this
  use case.

### Keep swallowing errors (maintain `UNKNOWN_DATA` fallback)
- **Pros:** Enrichment never surfaces as "failed" to the user.
- **Cons:** Silent failures are worse UX than visible failures — the user sees
  "enriched" data that is entirely Unknown with no way to know it's stale or
  broken. Debugging API key issues requires looking at raw logs.
- **Rejected:** Honest failure state is better for a portfolio project; the
  BullMQ retry mechanism handles transient failures automatically.

## Consequences

- `GROQ_API_KEY` is required for enrichment (optional in Joi schema — app starts
  without it, but enrichment jobs fail with `FAILED` status and a logged warning).
- `ANTHROPIC_API_KEY` is no longer read or required anywhere in the codebase.
- Enrichment failures are now visible: BullMQ will retry the job up to its
  configured attempt limit; after exhaustion, `CompanyProfile.status` is `FAILED`.
- The `str()` helper in `LlmService` tightens the sanitise step: empty strings
  now also map to `'Unknown'` (previously only `undefined`/non-string did).
- Groq rate limits are different from Anthropic's — if the free tier is ever
  exhausted, failures surface immediately as `FAILED` enrichment status, which
  is the correct, observable behaviour.
