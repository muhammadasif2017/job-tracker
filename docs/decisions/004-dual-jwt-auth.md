# ADR-004: Dual JWT (access + refresh) with hashed refresh token storage

## Status
Accepted

## Date
2026-06-12

## Context

The application needs authentication that supports:
1. Email/password login
2. Google and GitHub OAuth
3. Session persistence across browser reloads (stay logged in)
4. The ability to revoke all sessions (logout)
5. Stateless operation as much as possible (no session store Redis requirement)

## Decision

Use **two JWTs per session**: a short-lived access token (15 minutes, `JWT_SECRET`)
and a long-lived refresh token (7 days, `JWT_REFRESH_SECRET`). On every refresh, both
tokens are rotated (old pair revoked, new pair issued).

**Refresh token storage:** the refresh token is stored in the database as a **bcrypt
hash** (`User.refreshTokens` — a separate `RefreshToken` table since security
hardening). On `POST /auth/refresh`, the incoming token is bcrypt-compared against the
stored hash. On logout, the stored hash is deleted, invalidating all sessions.

**Client-side storage:**
- Access token → `localStorage` (`jt_access`), read by the Axios request interceptor.
- Refresh token → `localStorage` (`jt_refresh`), sent in the body to `POST /auth/refresh`.
- Auth presence → `jt_authed` cookie (value `1`, SameSite=Lax), read by `proxy.ts`
  for route protection without touching the JWT in middleware.

The client-side interceptor in `lib/api.ts` handles the refresh → retry flow:
on a 401, it POSTs the refresh token, updates storage, and retries the original
request. Concurrent 401s are queued and drained once the refresh completes.

## Alternatives Considered

### Server-side sessions (express-session)
- **Pros:** Revocation is trivial (delete the session record). CSRF protection is
  simpler. No token storage on the client.
- **Cons:** Requires a session store (Redis or DB). Adds statefulness to every API
  request (session lookup). NestJS + Passport have first-class JWT support; sessions
  require more plumbing.
- **Rejected:** The free-tier constraint discourages adding Redis just for sessions.
  JWT fits the stateless API model better.

### Single long-lived JWT (no refresh token)
- **Pros:** Simplest implementation — one token, no refresh logic.
- **Cons:** Can't be revoked without a blocklist. A stolen token is valid until
  expiry. Setting a long expiry (7 days) means a leaked token is useful for 7 days.
- **Rejected:** Unacceptable security trade-off for any app storing user data.

### OAuth-only (no email/password)
- **Pros:** No password storage or hashing; delegates credential security to Google/GitHub.
- **Cons:** Forces users to have a Google or GitHub account. Friction for users who
  prefer email/password. A portfolio project should demonstrate both flows.
- **Rejected:** Partial solution; both flows are included.

### Storing refresh tokens in plaintext
- **Pros:** Simpler comparison (string equality vs bcrypt).
- **Cons:** A database breach would expose all active refresh tokens. bcrypt ensures
  that even if the `refresh_tokens` table is leaked, tokens can't be replayed.
- **Rejected:** Bcrypt-hashing refresh tokens is standard practice; the performance
  cost (single bcrypt compare per refresh) is acceptable.

### Storing the refresh token in an HttpOnly cookie
- **Pros:** Not accessible to JavaScript; better XSS resistance.
- **Cons:** Requires CORS `credentials: true` and a carefully configured
  `SameSite`/`Domain` policy. In this deployment (frontend on Vercel, backend on
  Oracle VM) cross-origin cookie sharing adds complexity with iframe/CORS edge cases.
  The `jt_authed` presence cookie already uses SameSite=Lax for route protection.
- **Not rejected on principle** — a reasonable upgrade for production hardening.

## Consequences

- The access token expires in 15 minutes. The client must handle 401 responses by
  refreshing, which `lib/api.ts` does transparently to callers.
- Token rotation on every refresh means that if a refresh token is stolen and used,
  the legitimate user's next refresh will fail (the old token was consumed), alerting
  them that something is wrong.
- The `issueTokens` private method is the single source of truth: it signs both
  tokens in parallel (`Promise.all`), bcrypt-hashes the refresh token, and persists
  it. Every authentication path (login, register, OAuth, refresh) converges here.
- OAuth and email/password users share the same token model; `handleOAuthUser`
  resolves the user (or creates one) and then calls `issueTokens`.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` must be different keys (using the same key
  for both would allow an access token to be submitted as a refresh token).
