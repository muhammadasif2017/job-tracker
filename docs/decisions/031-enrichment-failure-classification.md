# ADR-031: Company enrichment failure classification — surface account-level errors, collapse everything else to two user-facing states

## Status
Accepted

## Date
2026-08-23

## Context

`CompanyEnrichmentProcessor` can fail for reasons spanning very different
severities: the LLM genuinely found nothing to extract (no website on file,
web search returned nothing), a downstream vendor call throws (Tavily search,
Groq LLM), or a vendor call fails for an *account-level* reason (API quota
exhausted, bad/revoked key) that no retry will fix. Getting this wrong went
through several iterations across separate PRs before landing:

- **#209/#210** (`d92a326`, `3fdb9d0`): migrated the enrichment LLM to
  `gpt-oss-120b` and stopped leaking raw backend error strings to the UI, but
  an empty-context run still burned a full LLM call only to have Groq refuse
  to call the required extraction tool and surface a `400 tool_use_failed` —
  indistinguishable from a real vendor failure.
- **#211** (`be01cbd`): added a fast-path that skips the LLM call entirely
  when the assembled context is empty, with a friendly "add a website"
  message — correct for the *legitimate* no-data case, but tool_use_failed
  errors that still reached the LLM (context non-empty but insufficient) kept
  rendering as a generic, unhelpful failure.
- **#212** (`23b1b93`): classified raw `tool_use_failed` strings as `NO_DATA`
  via a message-regex classifier on the frontend (`company-profile-card.tsx`)
  — but that classifier was vendor-error-text-based, and it also introduced a
  `CONFIG` bucket for messages that looked like configuration problems.
- **#227** (`5d1abb1`, this ADR's trigger): the regex-based `CONFIG`
  classification caught Tavily's quota-exceeded response (`429`/`432`) and
  mislabeled it "not configured correctly" — actionable-sounding but wrong;
  quota exhaustion isn't a config bug and resets on its own, but a user
  reading "check your configuration" would go looking for a bad API key that
  doesn't exist.

The recurring root problem: classifying failures by pattern-matching
whatever error *string* happened to reach the frontend is unreliable,
because the string's shape depends on which layer (search vendor, LLM
vendor, empty-context guard) produced it and vendors don't guarantee stable
wording.

## Decision

### Backend: a dedicated exception type for account-level search failures

```ts
// search.service.ts
export class SearchUnavailableError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
```

Thrown only for Tavily `429`/`432` (quota/rate-limit) and `401`/`403`
(bad/revoked key) — the two cases a caller actually needs the real reason
for. Every other search failure (network error, 5xx, malformed response)
still degrades to `[]` silently, same as before; `SearchUnavailableError` is
the one shape the processor treats specially rather than swallowing.

`CompanyEnrichmentProcessor` catches it per-call, stores the message in
`searchUnavailableReason`, and only *surfaces* it if the run ends up with
zero usable context — a search failure that still leaves the official-site
fetch usable doesn't hard-fail the run:

```ts
if (!context.trim()) {
  throw new Error(
    searchUnavailableReason ??
      'No extractable content: ...',
  );
}
```

This replaces classification-by-parsing-the-final-error-string with
classification at the point the real cause is known (inside `search.service.ts`,
which knows it got a `429` vs. a generic network failure) — the *type* of
error crossing the module boundary carries the distinction, not its message
text.

### Frontend: collapse to two states, drop the config/rate-limit buckets entirely

```ts
type FailureKind = 'NO_DATA' | 'FAILED';
```

`NO_DATA` (genuinely nothing to extract — no website, no search results) is
the only state with a distinct, actionable message ("add a website").
Every other cause — rate limit, bad key, vendor outage, malformed LLM
response — collapses to the same `FAILED` copy: "try Refresh, check server
logs if it keeps failing." This app has a single technical user who can read
server logs directly; a `CONFIG` vs. `RATE_LIMITED` distinction in the UI
added surface area for exactly the kind of message-text misclassification
that caused #227, for no material benefit to that user. `classifyFailure`
still exists (matching `no extractable content` and `tool_use_failed`
patterns into `NO_DATA`), but the failure mode of a misclassification is now
"generic message instead of specific" rather than "actively wrong specific
message."

## Alternatives Considered

### Keep the CONFIG/RATE_LIMITED frontend buckets, fix only the regex to correctly separate Tavily's 429/432 from 401/403
Rejected: the backend now already knows the precise distinction at the
point of failure (`SearchUnavailableError.status`); re-deriving the same
distinction a second time via frontend string matching duplicates logic and
reopens the door to the next vendor wording change causing the same
misclassification. Since the UI copy for both buckets would resolve to
"retry / check logs" anyway for this app's single-user context, the buckets
added classification risk without adding user value.

### Have the processor pass `SearchUnavailableError.status` through to the frontend as a typed field instead of folding it into the error message string
Rejected: `Company.errorMessage` is a single `String?` column with no schema
change in scope for this fix; a typed status code would require a migration
and a new field just to preserve a distinction the frontend no longer
renders differently anyway.

### Retry once inside `SearchUnavailableError` handling before giving up
Rejected: BullMQ already retries the job itself; a quota-exhausted or
bad-key failure will fail identically on an immediate in-process retry, so
retrying inside the search call would just delay the same outcome.

## Consequences

- A vendor wording change (Tavily or Groq) can no longer mis-route a user
  into a wrong actionable message — the worst case is now "the specific
  reason isn't shown," not "the wrong specific reason is shown."
- Adding a third, genuinely-distinct user-facing failure state in the future
  should follow the `SearchUnavailableError` pattern (a typed exception
  raised at the point the real cause is known) rather than a new frontend
  regex over `errorMessage` text.
- `classifyFailure` in `company-profile-card.tsx` is now the single point
  reconciling backend error strings into UI copy for both the job-detail and
  company-detail pages (shared since ADR-029's card unification) — a new
  failure-message pattern needs updating in exactly one place.
