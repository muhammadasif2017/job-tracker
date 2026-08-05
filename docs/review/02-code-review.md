# Job Tracker — Code Review: Deficiencies & Improvements

> A line-level review of the whole codebase. Findings are grouped by severity.
> Each item names the **file:line**, explains the **problem**, gives the **why it
> matters**, and a **suggested fix**. Nothing here has been changed in the code —
> this is a review you can act on selectively. Pair it with `01-architecture.md`.
>
> Honest framing for interviews: most of these are *appropriate trade-offs for a
> single-user portfolio app*, not bugs. The value is being able to name them
> yourself before an interviewer does.

Severity legend:
- 🔴 **High** — correctness/security issue a user could actually hit.
- 🟠 **Medium** — real bug or design limitation under realistic use.
- 🟡 **Low** — cleanliness, consistency, DRY, or future-proofing.

---

## 🔴 High

### H1. Single-device sessions: any login silently kills other sessions ✅ RESOLVED (RefreshToken is now a separate table, one row per session)
**Where:** `backend/src/auth/auth.service.ts:116-137` + `prisma/schema.prisma:35`
(`refreshToken String?` — one column per user).

**Problem:** The user row stores exactly **one** bcrypt-hashed refresh token.
`issueTokens` overwrites it on *every* login and *every* refresh. So logging in on
your phone overwrites the laptop's refresh token; when the laptop's 15-minute
access token expires, its refresh fails (`refresh()` bcrypt-compare at
`auth.service.ts:55` no longer matches) and the laptop is force-logged-out.

**Why it matters:** Multi-device / multi-tab usage is normal. This makes concurrent
sessions mutually exclusive.

**Fix:** Model refresh tokens as their own table —
`RefreshToken { id, userId, tokenHash, expiresAt, createdAt, revokedAt }` — one row
per session. Validate against the matching row and rotate that row only. This also
unlocks "log out everywhere" and "active sessions" features.

### H2. OAuth code store is in-memory and never swept
**Where:** `backend/src/auth/auth.service.ts:15-18, 68-85`.

**Problem:** Pending OAuth codes live in a process-local `Map`. Two issues:
1. **Doesn't survive scaling/restart** — with two backend replicas (or a restart
   between redirect and exchange) the `/auth/exchange-code` call may hit an instance
   that never stored the code → login fails. The app is single-instance today, so
   this is latent, but it's a hard ceiling on horizontal scaling.
2. **No proactive sweep** — each entry does carry an `expiresAt` timestamp
   (60 s) and `exchangeOAuthCode` rejects expired codes, but the Map entry
   itself is *never removed* unless someone actually calls `exchangeOAuthCode`.
   A user who starts OAuth and never lands on `/callback` leaves a dead entry
   in the Map indefinitely (a slow memory leak). "Expires" and "gets cleaned
   up" are different things — this only has the former.

**Why it matters:** It's the one piece of auth that assumes a single, long-lived
process — worth calling out explicitly.

**Fix:** Store codes in a short-TTL store shared across instances (Redis with
`EX 60`, or a DB table with an `expiresAt` and a periodic cleanup). For
single-instance, at minimum add a `setInterval` sweep or lazily purge expired
entries on each write.

### H3. "Change Password" section can be wrongly hidden for hybrid accounts ✅ RESOLVED (commit `3564e00`)
**Where:** frontend `app/(dashboard)/profile/page.tsx:84` and backend
`users.service.ts:30-36`.

**Problem:** The UI decides whether to show the password form with
`hasPassword = !profile || !profile.connectedProviders?.length` — i.e. "if you have
*any* connected OAuth provider, assume you have no password." But a user who
**registered with email (has a password) and later linked Google** has *both*. For
them the form is hidden even though they can change their password. The backend
never actually tells the client whether a password is set.

Relatedly, `users.service.ts:34` returns `hasPassword: undefined` — **dead code**:
`hasPassword` was never `select`ed, so this line resolves to `undefined` and is
dropped from the JSON. It looks like an intended feature that was left unfinished.

**Why it matters:** A real account can't reach a real feature.

**Fix:** Have the backend select `password` and return a boolean
`hasPassword: !!user.password` (never the hash). Drive the UI from that flag
instead of inferring from providers. Remove the no-op `hasPassword: undefined`.
(Note: the backend *guard* in `changePassword` at `users.service.ts:55-59` is
correct and safe — this is purely a UI-gating bug.)

---

## 🟠 Medium

### M1. Kanban drag doesn't refresh dashboard stats ✅ RESOLVED
**Where:** `frontend/components/jobs/kanban-board.tsx:64` (`onSettled`).

**Problem:** After a drag changes a job's status, `onSettled` only invalidates
`['jobs']`. It does **not** invalidate `['stats']`. The job-detail status dropdown
*does* invalidate stats (`jobs/[id]/page.tsx:92`), so the two paths are
inconsistent. Drag a card from Applied → Interviewing, go to the dashboard, and the
counts/chart are stale until something else refetches them.

**Fix:** Add `qc.invalidateQueries({ queryKey: ['stats'] })` in the kanban
`onSettled` (and arguably `['job-events']` if a detail view could be open).

### M2. `accessToken` is stored in two places and can drift ✅ RESOLVED
**Where:** `frontend/store/auth.store.ts:10,24,41-45` vs `frontend/lib/auth.ts`.

**Problem:** The access token is persisted **both** in Zustand (`jt-auth`
localStorage, via `partialize`) and in `tokenStorage` (`jt_access`). But the Axios
interceptor reads only `tokenStorage` (`api.ts:9`), and the silent-refresh path
updates only `tokenStorage` (`api.ts:65`) — it never updates the Zustand copy. So
after a refresh, `useAuthStore().accessToken` is stale/wrong. It happens to not
break anything because nothing reads the store's `accessToken` for requests, which
means **it's redundant state pretending to be a source of truth.**

**Fix:** Pick one home for the access token. Simplest: drop `accessToken` from the
store entirely (keep only `user` + `isAuthenticated`); let `tokenStorage` own
tokens. Less state, no drift.

### M3. No unit tests; e2e depends on a live database ✅ RESOLVED (unit specs exist for AuthService, JobsService, UsersService, ResumesService, enrichment, storage, and the PrismaExceptionFilter)
**Where:** `backend/test/app.e2e-spec.ts` (runs against the dev DB);
`package.json` `test` script is `jest --passWithNoTests`.

**Problem:** There is no isolated unit coverage of the trickiest logic — token
rotation, `handleOAuthUser` linking branches, `getStats` math, CSV escaping, the
Axios refresh queue. The only backend tests need a real Postgres and mutate it.

**Why it matters:** The bugs most likely to regress (H1, the OAuth branches, stats
math) are exactly the ones not unit-tested. Interviewers often probe testing depth.

**Fix:** Add service-level unit tests with a mocked `PrismaService` for
`AuthService`/`JobsService`/`UsersService`, and a Jest test for the Axios
interceptor queue. Keep the e2e as the integration safety net. Consider a
disposable test DB (testcontainers / a separate schema) so e2e isn't run against
dev data.

### M4. Date-only fields can shift by a day across timezones
**Where:** `job-form.tsx:76,83` (`appliedAt: ...split('T')[0]`) →
`jobs.service.ts:23` (`new Date(dto.appliedAt)`).

**Problem:** The form sends a date-only string like `"2026-06-11"`. `new Date(
"2026-06-11")` parses as **UTC midnight**. A user in a negative UTC offset (e.g.
US) viewing it back can see the *previous* day. The DTO validates with
`@IsDateString`, which accepts the bare date, so it passes through.

**Fix:** Decide on a convention and apply it consistently — either store these as a
Postgres `DATE` (no time component) or normalize to local noon before constructing
the `Date`. At minimum, format on display using the same assumption used on input.

### M5. `GET /jobs/stats` ordering dependency on `GET /jobs/:id`
**Where:** `backend/src/jobs/jobs.controller.ts` — `stats` route registered before `/:id`.

**Problem:** `/jobs/stats` is a fixed segment that works because NestJS resolves
fixed routes before parameterized ones — but only when the fixed route appears
*first* in the controller file. If `stats` is ever moved below `/:id`, it silently
matches `id = "stats"` and returns a 404 instead. Same applies to `/jobs/export`.

**Why it matters:** Invisible ordering constraint with no guard or comment. Any
route reorganization breaks silently.

**Fix:** Move stats and export under a distinct sub-resource path
(`GET /jobs/summary/stats`, `GET /jobs/summary/export`) to eliminate the
dependency, or add a comment in the controller noting the ordering is load-bearing.

### M6. `GET /jobs/resumes/file` is misplaced in the route hierarchy
**Where:** `backend/src/resumes/resumes.controller.ts` — route is `/jobs/resumes/file`.

**Problem:** This endpoint serves a file for a specific job's resume but sits at a
path that collides with the `/jobs/:id` param pattern — `/jobs/resumes/file` matches
`id = "resumes"` in the jobs router before the fixed segment is recognized.
Additionally, the authorization check derives `userId` from the key string format
(`resumes/<userId>/...`) rather than from the authenticated user session, meaning a
key format change silently breaks the authorization logic.

**Fix:** Move to `GET /jobs/:jobId/resumes/file` to match the rest of the resumes
sub-resource (`POST /jobs/:jobId/resumes`, `GET /jobs/:jobId/resumes`, etc.).
Derive `userId` from `@CurrentUser()`, not from the key structure.

### M4b. Email change leaves the JWT's email claim stale
**Where:** `users.service.ts:38-51`.

**Problem:** Updating the email updates the row but not the already-issued access
token, whose `email` claim now disagrees with the DB until the next refresh (15 min
max). Low impact because authorization keys off `sub` (the id), not email, but it's
a correctness smell if anything ever trusts the token's email.

**Fix:** Either re-issue tokens on email change, or document that token claims are
snapshots refreshed on rotation.

---

## 🟡 Low (cleanliness, DRY, consistency, future-proofing)

### L1. Duplicated Prisma `where`-builder in jobs service ✅ RESOLVED
**Where:** `jobs.service.ts:48-66` (`findAll`) and `178-196` (`exportCsv`) — the
status/priority/search/date filter object is copy-pasted.

**Fix:** Extract `private buildJobWhere(userId, query)` and call it from both. One
place to change when a filter is added.

### L2. Job status enum is defined in three places (no single source of truth) ✅ RESOLVED (job-form.tsx already uses `z.enum(JOB_STATUSES)`; frontend type is derived from the array, not hand-written)
**Where:** `prisma/schema.prisma:9-16` (DB enum) → mirrored by hand in
`frontend/types/index.ts:1-7` → and again as a `z.enum([...])` literal in
`job-form.tsx:26-33`.

**Problem:** Add a status and you must edit three files; miss one and types lie.

**Fix:** Derive the Zod enum from the `JOB_STATUSES` array
(`z.enum(JOB_STATUSES)`), and consider sharing types between front/back via a small
shared package or by generating the frontend union from the Prisma enum.

### L3. `JobQuery` frontend type is missing `priority`
**Where:** `frontend/types/index.ts:69-78`.

**Problem:** The jobs page filters by priority, but the `JobQuery` interface doesn't
list it. The page doesn't use this type for the request (it builds a
`URLSearchParams` directly), so it compiles — but the type is now an inaccurate
description of the query contract.

**Fix:** Add `priority?: JobPriority;` to `JobQuery`.

### L4. `PrismaExceptionFilter` detects Prisma errors by duck-typing
**Where:** `common/filters/prisma-exception.filter.ts:23,29,37`
(`exception?.getStatus`, `exception?.code === 'P2002'`).

**Problem:** It infers "this is a Prisma error" from the presence of a `.code`
string rather than `instanceof Prisma.PrismaClientKnownRequestError`. Works today,
but it's fragile — any thrown object with a `.code` of `'P2002'` would be
mistranslated, and it relies on the adapter surfacing the code on the same shape.

**Fix:** Narrow with `instanceof` against Prisma's known-error classes, and
consider splitting the catch-all "fallback 500" into its own filter so the file's
name matches its responsibility.

### L5. `update` vs `create` handle `url` inconsistently
**Where:** `jobs.service.ts:19` (`url: dto.url || undefined`) vs `:105`
(`url: dto.url`).

**Problem:** Create converts empty/missing URL to `undefined`; update passes it
through. The frontend already strips empties to `undefined`, so it's currently
harmless, but the asymmetry is a latent trap if another client ever PATCHes
`url: ""` (which would fail `@IsUrl` anyway). Minor.

**Fix:** Mirror the create-side normalization in update for consistency.

### L6. `callback` effect has an exhaustive-deps gap
**Where:** `app/(auth)/callback/page.tsx:15-42` — `useEffect(() => {...}, [])` uses
`params`, `router`, `setAuth`.

**Problem:** Intentional run-once, but ESLint's `exhaustive-deps` will flag it, and
the empty array hides the dependency. It's fine functionally.

**Fix:** Either add an `// eslint-disable-next-line react-hooks/exhaustive-deps`
with a comment explaining "run once on mount," or guard with a ref. Cosmetic.

### L7. No API versioning / global prefix
**Where:** routes are `/auth`, `/jobs`, `/users` (controllers).

**Problem:** No `/api` prefix or `/v1` namespace, so a breaking API change has
nowhere to live beside the old one.

**Fix:** `app.setGlobalPrefix('api')` and/or Nest's URI versioning. Low priority for
a portfolio, but a natural "how would you evolve this" answer.

### L8. `me` endpoint duplicates `users/me`
**Where:** `auth.controller.ts:79-82` (`GET /auth/me`) returns `req.user`; the
frontend also has `GET /users/me` (`users.controller.ts:19`) returning the richer
profile (with `connectedProviders`, `hasPassword`, `createdAt`).

**Problem:** Two "who am I" endpoints with different shapes. Two sources of truth
means two places to update if the user model changes. Not wrong, but the distinction
is invisible to a new reader — `/auth/me` returns `{ id, email, name, avatarUrl }`
while `/users/me` returns a superset. There's no documentation on which to use when.

**Fix:** Deprecate `GET /auth/me` and consolidate on `GET /users/me`. If a lightweight
"validate my token" check is needed, the existing `/auth/me` shape can remain but
should be documented as a token-ping, not a profile endpoint.

### L12. Inconsistent `DELETE` response body across modules
**Where:** `resumes.controller.ts` (`DELETE /jobs/:jobId/resumes`) vs
`jobs.controller.ts` (`DELETE /jobs/:id`) and `users.controller.ts` (`DELETE /users/me`).

**Problem:** Job delete returns `{ message: "Job deleted" }`, account delete returns
`{ message: "Account deleted" }`, but resume delete returns an empty 200 body.
Callers can't apply the same response-handling pattern.

**Fix:** Return `{ message: "Resume deleted" }` from the resume delete handler, or
switch all deletes to 204 No Content (no body). Pick one and apply it everywhere.

### L13. Verb in URL — `POST /jobs/:id/enrich`
**Where:** `backend/src/enrichment/enrichment.controller.ts`.

**Problem:** `/enrich` is a verb, not a resource noun — a REST anti-pattern. The
REST equivalent of "trigger enrichment" is "create an enrichment request."

**Fix:** Rename to `POST /jobs/:id/enrichment`. It reads as creating an enrichment
resource (consistent with how `/jobs/:jobId/resumes` treats resume upload), and the
response `{ message: "Enrichment queued" }` still makes sense.

### L14. `responseRate` in stats is opaque
**Where:** `backend/src/jobs/jobs.service.ts` — `getStats` method.

**Problem:** The stats endpoint returns `responseRate: number` with no indication of
what counts as a "response" (any non-APPLIED status? interviews + offers only?). A
frontend developer reading the API contract can't use this field correctly without
reading the service implementation.

**Fix:** Either rename to something self-documenting (`interviewConversionRate`) or
add a companion field (`responseRateBasis: "interviews + offers / applied"`) in the
response. At minimum, document the formula in a comment on the service method.

### L9. CSV export ignores `sortBy`/`page` but shares the query DTO
**Where:** `jobs.service.ts:175-202`. `exportCsv` accepts a full `JobQueryDto` but
only reads the filter fields and hard-codes `orderBy: { appliedAt: 'desc' }` and
`take: 10_000`. Fine, but a caller passing `sortBy` will be silently ignored.

**Fix:** Either honor `sortBy` or use a narrower DTO that only exposes the filters
export actually supports.

### L10. Minor: `Spinner` and `Button` re-implement the same SVG spinner
**Where:** `components/ui/spinner.tsx` and the inline SVG in `components/ui/button.tsx:55-69`.

**Fix:** Have `Button`'s loading state render `<Spinner />` to remove the
duplicated SVG. Trivial.

### L11. Typo in the committed CLAUDE.md guidelines
**Where:** `CLAUDE.md` / `backend/CLAUDE.md` — `"YOUR changes m;;''ade unused"`.
Harmless, but it's in a checked-in doc a reviewer might see.

---

## Things that are *correct* and worth defending (not deficiencies)

So you don't "fix" good decisions under interview pressure:

- **Tokens in `localStorage`** (`lib/auth.ts`). Trade-off vs. `httpOnly` cookies:
  localStorage is XSS-readable but immune to CSRF and trivial to attach to an
  Axios header; httpOnly cookies resist XSS but need CSRF protection and don't fit
  a cross-origin SPA→API cleanly. The project mitigates by keeping the *routing*
  signal in a non-sensitive cookie and using short-lived access tokens. This is a
  legitimate, defensible choice — see `03-interview-guide.md` for how to frame it.
- **`proxy.ts` checks only cookie presence.** Correct: middleware can't validate a
  JWT cheaply and shouldn't be the security boundary. The API guard is the real
  enforcement.
- **JWT strategy hits the DB every request.** A deliberate freshness/revocability
  trade-off, not an oversight (see `01-architecture.md §3.3`).
- **404 (not 403) for other users' jobs** (`jobs.service.ts:84-92`). Intentional —
  avoids leaking which ids exist.
- **`@Catch()` catch-all filter.** Intentional global error funnel; it explicitly
  re-passes `HttpException`s.
- **Event written in the same nested Prisma `create`.** This is the *good* version
  of audit logging (atomic with the mutation), not a missing transaction.

---

## Suggested priority order if you do touch the code

> ✅ = already done; remaining items listed in suggested order.

1. ~~**H3** + the `hasPassword` backend flag~~ ✅ RESOLVED (commit `3564e00`)
2. ~~**M1** — one line, removes a confusing stale-stats moment~~ ✅ RESOLVED
3. ~~**M2** — delete redundant token state~~ ✅ RESOLVED
4. ~~**L1** — extract `buildJobWhere`~~ ✅ RESOLVED
5. ~~**M5 / M6** — route ordering + `/jobs/resumes/file` comments~~ ✅ RESOLVED
6. ~~**L12 / L13 / L14** — DELETE message consistency, `/enrichment` rename, `responseRate` comment~~ ✅ RESOLVED
7. ~~**M3** — unit tests for auth/stats/CSV logic~~ ✅ RESOLVED (specs already existed)
8. ~~**L2** — Zod enum derived from `JOB_STATUSES`~~ ✅ RESOLVED (already done)
9. ~~**H1** — multi-device sessions / RefreshToken table~~ ✅ RESOLVED (separate table, one row per session)
10. **H2** — in-memory OAuth code store; describe as "the next iteration." Makes an excellent "how would you productionize this?" answer.
11. **M4** — date-only timezone shift; low impact but worth knowing in interviews.
12. **M4b** — email change leaves JWT email claim stale; low impact, good talking point.
