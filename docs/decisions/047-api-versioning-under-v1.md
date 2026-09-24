# ADR-047: The API is versioned under `/v1`, with an unversioned alias

## Status

Accepted

## Date

2026-09-24

## Context

No route carried a version. A future breaking change to a response shape
would have had to land for every client at once: the web frontend (deployed
on Vercel), the browser extension (installed separately, updated whenever
its user reloads it), and whatever calls the API next. Nest supports URI
versioning natively, so the cost is mostly in what sits outside the router:

- **The refresh cookie** is scoped by `Path`. The browser only sends it to
  URLs under that path, so it has to follow the route that reads it.
- **The OAuth callback URLs** are registered in the Google and GitHub
  consoles. Moving them breaks sign-in until both consoles are edited.
- **`/health`** is polled by three CI workflows (`wait-on`) and by
  monitoring. It describes the process, not an API contract.
- **Clients already running:** an installed extension, and a browser tab
  still running the previous frontend build.

## Decision

`applyApiVersioning` (`backend/src/config/api-versioning.helper.ts`) enables
URI versioning with `defaultVersion: ['1', VERSION_NEUTRAL]`. It is called
from `main.ts` and mirrored in the e2e setup.

- **Every route is served at `/v1/...` and at its old unversioned path.**
  The alias keeps existing clients working without a coordinated cut-over.
  Removing it later is a one-line change, made once the unversioned paths
  stop getting traffic.
- **`/health` and the four OAuth routes** (`/auth/google`,
  `/auth/github` and their callbacks) are `@Version(VERSION_NEUTRAL)` and
  exist **only** unversioned. That keeps them stable when the alias goes:
  probes and the provider consoles never have to change.
- **The refresh cookie is scoped to the auth routes of the URL surface the
  request came in on.** A `/v1/...` request gets `Path=/v1/auth`; a request
  through the alias gets `Path=/auth` (`refreshCookiePathFor`). A browser
  only sends a cookie to paths under its `Path`, so each client keeps its
  cookie where it will later refresh. The cookie is still never widened to
  `/`.

  A single `/v1/auth` path was the first version of this decision, and review
  caught why it fails. A tab still on the old build refreshes through
  `/auth/refresh`. Its rotated cookie would then land on `/v1/auth` while the
  old `/auth` cookie survived, so its next refresh would replay the revoked
  token. Replay detection deletes every session the user has.
- **Logout clears both paths with the cookie's own attributes.** A clearing
  `Set-Cookie` must carry the same `SameSite=None; Secure` as the original.
  The production API is cross-site, and a browser drops a cross-site
  `Set-Cookie` without them. Before this change, logout's clear sent only a
  path, so in production it never removed the cookie.
- **Idempotency keys ignore the version prefix.** `/v1/jobs` and `/jobs`
  are one handler, so a retry that switches between them hits the same key
  (`unversionedPath` in the interceptor).
- **Clients:**
  - The frontend's axios instance uses `API_BASE_URL` =
    `${NEXT_PUBLIC_API_URL}/v1`. `NEXT_PUBLIC_API_URL` stays the bare
    origin, so the Vercel environment needs no change, and the OAuth links
    built from it stay unversioned.
  - The browser extension prefixes `/v1` from `config.js`. The stored
    `backendUrl` stays the origin, so a saved connection keeps working.
  - Playwright's `API` fixture includes `/v1`, so `page.route` patterns
    match the app's requests.
- **Swagger lists each route once**, at its `/v1` path, because
  `withoutUnversionedAliases` removes the aliases from the document. The
  frontend's generated API types follow the same paths.

## Consequences

- **The backend deploys before any client moves.** Vercel ships the
  frontend minutes before `deploy.yml` finishes the backend, so a frontend
  calling `/v1` on the old backend would get 404s. The change therefore
  ships as two PRs: the backend first (versioning and the alias, harmless to
  current clients), then the frontend, extension and Playwright switch to
  `/v1` once that deploy is live.

- **One-time sign-in after the frontend switches.** A session from before
  this change holds its refresh cookie on `/auth`, which is not sent to
  `/v1/auth/refresh`. The next time its access token expires, that user signs
  in again. This is accepted: the app has one user today, and the
  alternatives (widening the cookie to `/`, or leaving auth unversioned)
  trade a permanent weakness for a one-off inconvenience.
- **A second version is additive.** A `v2` controller or handler is added
  beside `v1` with `@Version('2')`. Unchanged routes keep serving both,
  through `defaultVersion`.
- **The alias is technical debt with a clear exit.** When nothing calls the
  unversioned paths, `VERSION_NEUTRAL` comes out of `defaultVersion`. The
  routes marked neutral above are unaffected.

## Alternatives rejected

- **Hard cut to `/v1` only.** It would break the installed extension and
  any open tab at deploy time, and needs the provider consoles edited in
  lockstep with the deploy.
- **Header or media-type versioning.** It is invisible in logs and browser
  address bars, harder to test with curl, and unnecessary for a single
  first-party API.
- **Refresh cookie at `Path=/`.** No re-login, but the long-lived credential
  would then go out with every API request instead of only the auth routes.
- **Leaving auth unversioned.** No re-login, but the one route group that
  most needs a stable contract would sit outside the versioning scheme.
