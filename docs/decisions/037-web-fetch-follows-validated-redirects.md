# ADR-037: Follow Redirects With Per-Hop Revalidation Instead of Failing Closed

## Status

Accepted. Replaces the `redirect: 'error'` decision inside
`WebFetchService`; the SSRF protection it existed to provide is retained.

## Date

2026-09-04

## Context

`WebFetchService.fetchPageText` guards against SSRF in two layers:
`resolveSafeUrl` does a DNS lookup and rejects the URL if *any* resolved
address is non-public (loopback, link-local including the
`169.254.169.254` cloud metadata endpoint, private ranges, IPv6 unique-local),
and the fetch itself passed `redirect: 'error'` so that a redirect target —
which `resolveSafeUrl` never saw — could not be followed.

The second layer was too blunt. `redirect: 'error'` makes `fetch` throw on
*any* 3xx, and ordinary websites redirect constantly:

- apex to `www` — `codenzy.com` answers `307 → https://www.codenzy.com/`
- `http` to `https`
- trailing-slash and locale normalisation

So the official-site fetch threw `TypeError: fetch failed` for a large share
of real companies. It failed identically for all four URLs the company
enrichment processor tries (`/`, `/about`, `/contact`, `/contact-us`), which
meant the `OFFICIAL COMPANY WEBSITE` section of the extraction context was
empty and enrichment silently degraded to search snippets alone.

Observed in production. Every fetch for a company whose site redirects:

```
web_fetch_failed  https://codenzy.com            "fetch failed"
web_fetch_failed  https://codenzy.com/about      "fetch failed"
web_fetch_failed  https://codenzy.com/contact    "fetch failed"
web_fetch_failed  https://codenzy.com/contact-us "fetch failed"
```

The consequences went beyond thinner context:

- **ADR-013's trust guard had nothing to score against.** It scores extracted
  `address`/`headquarters` values by token overlap with official-site text.
  With no official text, every extracted value scores 0 and is flagged
  low-confidence — so the guard degraded from "corroborate this" to "flag
  everything", and `address` could never be populated at all.
- **ADR-011's domain disambiguation hint lost its backing.** The hint tells
  the model to prefer content from the company's own domain, but no content
  from that domain was ever in the context.
- **It cost Tavily credits.** `shouldFallbackSearch` in the enrichment
  processor fires when official text is under 300 characters — i.e. precisely
  when the fetch failed — spending a second, domain-restricted search to
  partially compensate. That extra call is the deferred item #6 in
  [ADR-035](./035-enrichment-search-quota-conservation.md).

## Decision

Follow redirects manually, revalidating every hop.

`fetch` is called with `redirect: 'manual'`, which hands back the 3xx instead
of acting on it. For each redirect, the `Location` header is resolved against
the URL that issued it (so a relative `/about-us` works), and the resulting
URL goes back through `resolveSafeUrl` before being fetched. A target that
fails validation aborts the whole fetch and logs `web_fetch_unsafe_redirect`
— it is never followed, and the loop does not fall through to a next hop.
Hops are capped at 3, after which `web_fetch_too_many_redirects` is logged and
the fetch returns empty.

This preserves the property the old code was protecting — **we never open a
connection to a non-public address** — while allowing the redirects that
normal sites depend on.

## Alternatives Considered

### Keep `redirect: 'error'` and store the post-redirect URL on the company

Have the user (or a one-off script) record `https://www.codenzy.com` rather
than the apex. Rejected: it pushes an implementation detail onto the user,
breaks whenever a site changes its canonical host, and does nothing for the
`http → https` case or for job-posting URLs the app fetches elsewhere.

### `redirect: 'follow'` and validate only the final URL

Rejected: it does not work. By the time `fetch` returns, the connection to
the intermediate address has already been made — which is the whole attack.
Validating afterwards detects the breach instead of preventing it.

### Pin the connection to the validated address with a custom dispatcher

The existing code comments note a residual TOCTOU gap: `fetch` re-resolves DNS
on connect, so a sub-second-TTL record could rebind between validation and
connection. A custom undici dispatcher that connects to the already-validated
IP would close both that gap and this one. Rejected for now for the reason the
original comment gives — more machinery than a solo-user job tracker warrants
— and because it is orthogonal: this ADR does not widen the TOCTOU window, it
just adds hops that each get the same validation the first URL gets.

## Consequences

- Official-site content reaches the extractor for companies whose domains
  redirect. Verified against the live site: `https://codenzy.com` now follows
  one hop to `https://www.codenzy.com/` and returns 35,464 bytes of real page
  content where it previously returned `''`.
- ADR-013's trust guard becomes meaningful again — extracted HQ/address values
  can now be corroborated against official text rather than uniformly flagged.
- Fewer Tavily calls: with official text over the 300-character threshold,
  `shouldFallbackSearch` stops firing, which removes the second search on
  exactly the runs that were previously making it.
- Up to 4 requests per URL in the worst case (initial + 3 hops), each with its
  own 10s timeout. The enrichment processor fetches up to 4 URLs, so a
  pathological site could stretch a run considerably. The `lockDuration` of
  90s on the worker still bounds it.
- Two new failure signals to look for in logs: `web_fetch_unsafe_redirect`
  (a redirect target that failed validation — worth investigating, it is the
  SSRF case actually firing) and `web_fetch_too_many_redirects`.
- Tests cover both directions: the apex-to-www regression, relative `Location`
  resolution, and — importantly — that a redirect to `169.254.169.254` is
  refused with only the first hop ever fetched.
