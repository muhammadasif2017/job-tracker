# ADR-027: Frontend failure/edge-case handling — error boundaries, isError states, request timeouts, error normalization

## Status
Accepted

## Date
2026-08-04

## Context

Frontend had no systematic handling for four failure classes:

1. **Unhandled render/runtime errors** — no Next.js `error.tsx`/`global-error.tsx`
   boundaries existed anywhere (root, `(dashboard)` segment). Any thrown error
   during render produced Next's default unstyled crash screen with no retry.
2. **Silent query failures** — several pages/components read only `data`/
   `isLoading` from TanStack Query, so a network failure or 4xx/5xx left the UI
   stuck on a loading spinner or a blank state instead of surfacing `isError`.
3. **Unbounded requests** — `lib/api.ts`'s shared `axios` instance had no
   `timeout`, so a hung backend (bad deploy, stalled DB connection) left
   requests pending indefinitely with no user-visible failure.
4. **Raw NestJS error shapes leaking into the UI** — `ValidationPipe` returns
   `message` as `string[]` for DTO validation failures and a plain `string`
   for everything else (`NotFoundException`, `ForbiddenException`, etc.).
   Code reading `err.response?.data?.message` directly and rendering it
   produced concatenated-with-no-separator text for the array case.
5. **Missing 404s** — no `not-found.tsx` at root or `(dashboard)` segment;
   unmatched routes fell through to Next's default 404.

## Decision

- Add `app/error.tsx`, `app/global-error.tsx`, `app/(dashboard)/error.tsx`,
  `app/not-found.tsx`, `app/(dashboard)/not-found.tsx` — styled boundaries
  with a "Try again" action (`unstable_retry`), consistent with the rest of
  the UI. `global-error.tsx` replaces `<html>`/`<body>` per Next's contract
  and can't use the shared `Button` component (renders outside the app
  layout/theme), so it's inline-styled.
- Every query/mutation-driven page or component now reads and branches on
  `isError` (not just `isLoading`/`data`), rendering an explicit error state
  instead of an indefinite loading spinner or blank render.
- `lib/api.ts` sets `DEFAULT_TIMEOUT_MS = 15_000` on the shared `axios`
  instance (and on the plain-`axios` refresh-token POST, which bypasses the
  instance and doesn't inherit it). Calls expected to legitimately run long
  override it per-request with a bounded, explicit value — never `timeout: 0`
  and never a raised global default. Current overrides: resume upload
  (120s, bounded by the existing 8 MB size cap) and Quick Add's
  `/jobs/parse` (60s — synchronous page-fetch + LLM extraction with a
  fallback search+retry pass).
- Add `getErrorMessage(err, fallback)` in `lib/api.ts`, exported alongside
  the default `api` instance, normalizing both NestJS error shapes into one
  readable string. All mutation `onError` handlers use it instead of reading
  `err.response?.data?.message` directly.

## Alternatives Considered

### Global error handler via axios response interceptor (toast on every failure)
Rejected: a blanket interceptor can't distinguish "this error is handled
inline by the caller with a specific message" from "this error needs a
generic toast," and would double-report errors that components already
render explicitly via `isError`. Per-call `isError` handling keeps the
failure UI co-located with the request that can fail.

### Raise `DEFAULT_TIMEOUT_MS` instead of per-call overrides for the two long-running calls
Rejected: a global timeout wide enough to cover a 60-120s LLM/upload call
would let every other (normally sub-second) request hang far longer than
useful before failing, delaying error feedback across the whole app for the
benefit of two call sites.

### `data-testid`/generic "Something went wrong" for all error states, no `getErrorMessage` normalization
Rejected: DTO validation failures are the most common backend error a user
hits (bad form input) and the most actionable — showing the real constraint
message ("email must be a valid email") is strictly better UX than a generic
fallback, and the normalization is a few lines shared across every mutation.

## Consequences

- New pages/components consuming TanStack Query must handle `isError`
  going forward — the pattern is now established, not optional, for
  data-fetching UI.
- Any new call site expected to run longer than 15s must set its own bounded
  `timeout` override rather than relying on/raising the shared default.
- `getErrorMessage` is the required path for surfacing backend errors in
  `onError` handlers; reading `err.response?.data?.message` directly is a
  regression back to the concatenated-array bug.
- `global-error.tsx` intentionally duplicates styling inline rather than
  reusing shared components/Tailwind classes — a maintenance cost if the
  visual language changes, traded for correctness under Next's constraint
  that it can't assume the rest of the app's providers are mounted.
