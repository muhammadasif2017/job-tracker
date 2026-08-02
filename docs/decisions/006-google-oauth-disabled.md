# ADR-006: Google OAuth disabled for initial release

## Status
Accepted

## Date
2026-06-13

## Context

The application supports two OAuth providers — Google and GitHub — via the dual-JWT auth
flow described in ADR-004. Both providers are fully implemented on the backend
(`GoogleStrategy`, `GithubStrategy`, callback routes, `handleOAuthUser`). The frontend
had `<OAuthButton provider="google" />` rendered on the login and register pages.

For the initial public release, the Google OAuth client credentials
(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) are not yet available. The backend
`GoogleStrategy` uses `?? 'placeholder'` so the server starts cleanly without real
credentials, but clicking the button would fail at the Google authorization endpoint.
Showing a broken button in a portfolio project is worse than not showing it.

GitHub credentials are available and working.

## Decision

Remove the Google OAuth button from the login, register, and profile pages for this
release. Specifically:

- `app/(auth)/login/page.tsx` — removed `<OAuthButton provider="google" />`
- `app/(auth)/register/page.tsx` — removed `<OAuthButton provider="google" />`
- `app/(dashboard)/profile/page.tsx` — filtered `'google'` out of the Connected Accounts list

The backend implementation (`GoogleStrategy`, `/auth/google`, `/auth/google/callback`)
is **left intact** — it is not deleted or disabled. The `?? 'placeholder'` guard means
the server continues to start without credentials.

## Alternatives Considered

### Show the button with a "coming soon" tooltip
- Pros: Communicates that the feature exists and is planned
- Cons: Adds UI complexity for a disabled state; interviewers clicking through the app
  may try it and see a confusing OAuth error page
- Rejected

### Disable Google on the backend (remove the strategy)
- Pros: No risk of the endpoint being called accidentally
- Cons: Deleting a complete, tested feature creates unnecessary rework when credentials
  arrive; the `?? 'placeholder'` guard already prevents startup failures
- Rejected

### Ship with credentials redacted (keep the button, let it fail gracefully)
- Pros: No code change needed
- Cons: The failure path goes through Google's consent screen, which returns a confusing
  error — not a graceful UX failure that we control
- Rejected

## Consequences

- GitHub OAuth is the only available social login for this release.
- Re-enabling Google requires adding three lines back in the two auth pages and one
  profile page, plus populating `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the
  production environment.
- The backend route `/auth/google` is still registered and reachable — it is not
  protected or removed. If Google credentials are added to the environment later, the
  feature activates without any backend change.
