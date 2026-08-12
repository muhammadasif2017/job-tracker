# ADR-028: Scoped personal access tokens for the browser extension

## Status
Accepted

## Date
2026-08-13

## Context

The browser extension (`browser-extension/`) needs to call the API (`POST
/jobs`, `POST /jobs/parse`) from a context that can't hold the httpOnly
`jt_refresh` cookie ADR-004 relies on — extensions don't share cookie storage
with the web app's origin, and expecting a user to stay logged into the web
app just to keep the extension alive is bad UX.

Requirements:
1. A long-lived credential the user generates once, pastes into the
   extension, and can revoke without affecting their normal browser session.
2. If that credential leaks (synced settings, clipboard manager, disk),
   blast radius should be much smaller than a stolen refresh token — the
   extension only ever needs to create/parse jobs, never change the
   password, delete the account, or mint more tokens.
3. Revocation should take effect quickly, not "whenever the token happens to
   expire."

## Decision

Add `ApiToken` (`TokensModule` — `POST/GET/DELETE /tokens`) as a distinct
credential type from the login/refresh pair, plus `AuthService.exchangeApiToken`
which trades a raw PAT for a normal-shaped 15-minute access JWT carrying two
extra claims the login/OAuth/refresh path never sets:

- `scope: 'pat'` (`PAT_SCOPE` in `tokens.constants.ts`)
- `patId`: the source `ApiToken.id`

`PatScopeGuard` (global, registered in `main.ts` right after `RolesGuard`)
rejects any `scope: 'pat'` request on a route that isn't explicitly marked
`@PatAccessible()` — opt-in, same shape as `@Public()`/`@Roles()`. A leaked
PAT-derived access token can only ever reach the handful of routes the
extension actually needs.

Because the exchanged JWT is otherwise stateless, `JwtStrategy.validate()`
re-checks the source `ApiToken` row's `revokedAt`/`expiresAt` on every
request when `scope === 'pat'` (skipped entirely for normal tokens, so this
adds no per-request DB cost to the web app's hot path). `DELETE /tokens/:id`
therefore takes effect on the next request, not up to 15 minutes later.

The raw token (`jt_pat_<uuid>.<secret>`) is shown once at creation
(`CreatedTokenDto`), stored as a bcrypt hash, and expires
`PAT_EXPIRY_DAYS` (180) days after creation regardless of use — bounding
exposure from a token the user forgets to revoke. `MAX_ACTIVE_TOKENS_PER_USER`
(20) is a sanity cap, not a security boundary. A dummy bcrypt hash
(`DUMMY_TOKEN_HASH`) is compared against on a not-found/revoked token id so
that branch takes the same time as a real mismatch, closing a timing oracle
that would otherwise let a caller enumerate valid token ids.

Full implementation detail lives in `backend/CLAUDE.md` ("Personal Access
Tokens (PATs) — Scoped, Not Full-Access") rather than duplicated here.

## Alternatives Considered

### Reuse the existing refresh-token flow for the extension
- **Pros:** No new credential type, no new guard.
- **Cons:** Refresh tokens are full-access and 7-day-rotating; there's no
  cookie storage in the extension to hold one safely, and a leaked refresh
  token is equivalent to a stolen session.
- **Rejected:** Doesn't meet requirement 2 (small blast radius).

### A separate API-key header checked by its own middleware (not a JWT at all)
- **Pros:** Simpler mental model — one credential type, one lookup, no
  exchange step.
- **Cons:** Every protected route would need two auth code paths (JWT guard
  vs. API-key guard) instead of one, or `@CurrentUser()` would need to
  understand two different req.user shapes. Rate limiting, logging redaction,
  and every future guard added to the JWT path would need a parallel
  implementation for API keys.
- **Rejected:** The exchange-to-JWT model reuses the entire existing
  guard/strategy/`@CurrentUser()` pipeline; `PatScopeGuard` is the only new
  piece of auth infrastructure.

### OAuth2 device-authorization flow
- **Pros:** Industry-standard pattern for input-constrained clients (CLIs,
  browser extensions, TVs); no manual copy-paste of a secret.
- **Cons:** Needs a device-code endpoint, polling, and a user-facing
  approval screen — substantial infra for a single-user extension talking to
  a single-user app.
- **Rejected:** Disproportionate to the problem size; revisit if third-party
  integrations are ever added.

### Unscoped PAT (any route a normal access token can reach)
- **Pros:** No `PatScopeGuard`, no `@PatAccessible()` annotation burden on
  every future route.
- **Cons:** A leaked PAT becomes equivalent to a leaked session — defeats
  requirement 2, the whole reason for a separate credential type.
- **Rejected:** Scoping is the point.

## Consequences

- New routes are PAT-inaccessible by default (fail closed) — extension
  functionality that needs a new endpoint requires remembering to add
  `@PatAccessible()`, the same opt-in cost `@Public()`/`@Roles()` already
  carry elsewhere in the codebase.
- `test/app.e2e-spec.ts` manually mirrors `main.ts`'s guard list, so
  `PatScopeGuard` had to be added there too — same maintenance burden noted
  in ADR-004/ADR-023 for the other global guards.
- The PAT-scope revocation check adds one extra `apiToken.findUnique` per
  request, but only on PAT-derived tokens (run concurrently with the
  existing user lookup via `Promise.all`), so it doesn't touch the
  request path for normal browser sessions.
- `TokensService.cleanupExpiredApiTokens` (daily cron) follows the exact
  pattern `AuthService.cleanupExpiredRefreshTokens` already established —
  no new cleanup mechanism was invented.
