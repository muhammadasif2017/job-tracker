@AGENTS.md

# Frontend CLAUDE.md

## Commands

```bash
npm run dev        # Next.js dev server on :3000
npm run build      # production build
npm run lint       # ESLint
npm test           # Vitest unit tests (components/*.test.tsx) — run before committing
npm run test:e2e   # Playwright e2e (requires both dev servers running)
```

**Turbopack cache corruption** — if pages enter an endless reload loop and the dev log shows `FATAL: ... Turbopack error` / `Next.js package not found`, the `.next` cache is corrupt (seen after disk I/O errors). Recovery: stop the dev server, verify nothing still listens on :3000 (a zombie node process serving the broken build will keep the loop alive, and a new server will silently start on :3002 where CORS/auth break), delete `.next`, restart.

---

## Next.js 16 Breaking Changes

- **`middleware.ts` → `proxy.ts`** and **`middleware()` → `proxy()`** — this is what Next.js 16 uses. Do not rename it.
- Route groups `(auth)` and `(dashboard)` add **no path segment**. `app/(auth)/login/page.tsx` → `/login`, not `/auth/login`.

---

## Tailwind v4 Dark Mode

Tailwind v4 has no `tailwind.config.js` — `app/globals.css`'s `@custom-variant dark (&:where(.dark, .dark *));` makes `dark:` respond to the `.dark` class instead of `prefers-color-scheme`; don't remove it, `theme-toggle.tsx` has no effect without it.

**Theme init must be global, not component-local.** The `.dark` class is applied by an inline pre-hydration script in `app/layout.tsx`'s `<head>`, not by `ThemeToggle` (which only flips/persists it and is dashboard-only) — a new top-level layout that skips this init renders light regardless of stored preference. Keep theme init in the root layout.

---

## Browser-only `Intl` Data in Client Components

`Intl.supportedValuesOf('timeZone')`-style calls depend on ICU data that differs between Node (SSR) and the browser, so computing them during render on a `'use client'` component can produce a hydration mismatch. Don't guard with a `mounted` `useEffect` flag (trips `react-hooks/set-state-in-effect`, as in `theme-toggle.tsx`); load via `next/dynamic(() => import(...), { ssr: false })` instead, as `components/profile/timezone-field.tsx` does. See ADR-024 for the incident this came from.

---

## Auth Guard (`proxy.ts`)

Runs on every request except static assets (see `matcher`). Reads the `jt_authed` cookie:

- No cookie + non-public path → redirect to `/login`
- Cookie present + public path (not `/callback`) → redirect to `/`

Public paths: `/login`, `/register`, `/callback`.

The cookie is a **presence signal only** (value `1`) — it does not contain a JWT. Real tokens live in `localStorage`.

---

## Auth State — Two Layers

### `lib/auth.ts` — tokenStorage

Pure `localStorage` wrapper for the access token only. Key: `jt_access`. Only the Axios interceptor should read/write this directly. The refresh token is **never** stored here — it's an `httpOnly` cookie (`jt_refresh`) set by the backend, invisible to JS entirely.

### `store/auth.store.ts` — Zustand store

Persisted to `localStorage` under key `jt-auth`. Exposes:

| Method                       | What it does                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `setAuth(user, accessToken)` | Writes to tokenStorage, sets `jt_authed` cookie (7d, SameSite=Lax), updates state |
| `setUser(user)`              | Updates user profile without touching tokens — used after profile edit            |
| `logout()`                   | Clears tokenStorage, expires cookie, resets state                                 |

**Always call `setAuth` after a successful login/OAuth/register** — it's the single place that syncs all three layers (tokenStorage, cookie, Zustand).

---

## Axios Instance (`lib/api.ts`)

Base URL from `NEXT_PUBLIC_API_URL`.

The instance is created with `withCredentials: true` — required both to let the browser store the `jt_refresh` httpOnly cookie from login/register/refresh responses, and to resend it on later requests.

Default `timeout: 15_000` (`DEFAULT_TIMEOUT_MS` in `lib/api.ts`) so a hung backend doesn't spin forever. Any call expected to legitimately run long must override it per-request with a bounded explicit value — don't raise the global default, and avoid `timeout: 0` (uncapped) even for large payloads; pick a generous-but-finite cap instead so a stalled connection still eventually surfaces. Current overrides: resume upload (`features/jobs/resume.hooks.ts`, `timeout: 120_000`, bounded by the 8 MB size cap) and Quick Add's `/jobs/parse` (`features/jobs/hooks.ts`, `timeout: 60_000`, synchronous page-fetch + LLM extraction with a fallback search+retry pass).

Also used by `app/(auth)/callback/page.tsx` to POST `/auth/exchange-code` with the OAuth code — same instance, so the refresh/queue interceptor applies to that call too.

`getErrorMessage(err, fallback)` (exported alongside the default instance) normalizes NestJS's `ValidationPipe` error shape — `message` is a `string[]` for DTO validation failures, a plain `string` otherwise — into one readable string. Use it in every mutation's `onError` instead of reading `err.response?.data?.message` directly; the raw array renders as concatenated text with no separator.

### Request Interceptor

Attaches `Authorization: Bearer <token>` unless the caller already set it. The manual header override is used when fetching `/auth/me` immediately after login (before the token is persisted).

### Response Interceptor — Refresh + Queue

Handles concurrent 401s without duplicate refresh calls:

1. First 401: marks `isRefreshing = true`, POSTs to `/auth/refresh` with no body — the browser attaches the `jt_refresh` cookie automatically.
2. Subsequent 401s while refreshing: queued in `failedQueue`, stamped `_retry = true` so a repeat 401 on the same request can't re-enter the refresh cycle.
3. On refresh success: drains queue, retries all queued requests with new token.
4. On failure (missing/expired refresh cookie): clears storage, expires cookie, `window.location.href = '/login'`.

`/auth/login` and `/auth/register` 401s bypass this and surface directly to the caller.

---

## Types (`types/index.ts`)

Single source of truth for all shared types and UI constants:

| Export                                  | Type                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `JobStatus`                             | Union: `'WISHLIST' \| 'APPLIED' \| 'INTERVIEWING' \| 'OFFER' \| 'REJECTED' \| 'GHOSTED'` |
| `Job`, `JobEvent`, `User`, `AuthTokens` | Core domain interfaces (`Job` has an optional `resume?: Resume \| null` field)           |
| `Resume`                                | `{ id, jobId, originalName, size, createdAt }` — storageKey is never sent to the client  |
| `InterviewRound`, `InterviewOutcome`    | `Job.interviewRounds?` — embedded on the job, not a separate fetch (see `InterviewRounds` component) |
| `JobStats`                              | `{ total, byStatus, thisMonth, responseRate }`                                           |
| `PaginatedJobs`                         | `{ data: Job[], meta: { total, page, limit, totalPages } }`                              |
| `JOB_STATUSES`                          | Ordered array of all statuses                                                            |
| `STATUS_LABELS`                         | Human-readable labels per status                                                         |
| `STATUS_COLORS`                         | Tailwind classes per status (for `<StatusBadge>`)                                        |
| `STATUS_DOT_COLORS`                     | Hex colors per status (for Kanban column dots and charts)                                |

`types/index.ts` stays hand-written — it mixes domain interfaces with UI-only constants (labels, Tailwind color maps) that have no OpenAPI equivalent.

### Generated API types (`types/api.generated.ts`)

Raw request/response shapes generated from the backend's Swagger/OpenAPI surface via `openapi-typescript`, to catch DTO drift that hand-maintained types miss. **Do not edit this file** — regenerate it instead:

```bash
# backend dev server must be running on :3001 first
npm run generate:api-types
```

Pulls from `http://localhost:3001/api/docs-json` (Nest Swagger's auto-exposed JSON, mounted alongside `SwaggerModule.setup('api/docs', ...)` in `backend/src/main.ts` — dev-only, gated on `NODE_ENV !== 'production'`). Not wired into any hook or component yet — `types/index.ts` and hand-written mutation payloads remain what the app actually uses. Treat `components["schemas"]["JobResponseDto"]` etc. as the reference to diff against when a DTO changes, or as a migration target for a given type, not an automatic replacement (nullability differs in places — e.g. hand-written `Job.location?: string` vs. the DTO's `string | null`).

**No CI staleness gate (deliberate, not an oversight).** A merge-blocking check would boot the backend (DB + Redis + secrets) in CI just to diff `api.generated.ts` against a fresh regen — real added CI cost, and `openapi-typescript` version bumps alone can shift output and cause false-positive failures unrelated to actual DTO drift. Skipped because nothing consumes the generated file yet, so staleness currently has zero correctness impact — the gate would protect a file nobody reads. Revisit once a hand-written type is actually migrated to the generated shape (see previous paragraph) — that's the point drift starts to matter and the gate earns its cost. Until then: regenerate manually (`npm run generate:api-types`) when touching a DTO with a schema decorator.

---

## Data Fetching Conventions (TanStack Query v5)

- Global defaults: `staleTime: 60_000`, `retry: 1` (set in `components/providers.tsx`).
- Query key pattern:
  - `['stats']` — dashboard stats
  - `['jobs', filters]` — paginated job list (filters object is part of the key)
  - `['job', id]` — single job detail (includes `resume` relation)
  - `['job-events', id]` — timeline events for a job
  - `['resume', jobId]` — resume metadata for a specific job; managed by `useUploadResumeMutation`/`useRemoveResumeMutation` (`features/jobs/resume.hooks.ts`) via `setQueryData` on mutation, not via invalidation
  - `['profile']` — user profile
- **Mutations always invalidate related keys on success.** When a job is created/edited/deleted, invalidate `['jobs']` and `['stats']`. On status change from job detail, also invalidate `['job-events', id]`.
- Use `qc.setQueryData` for optimistic updates (see `KanbanBoard` drag-and-drop) — always roll back in `onError`.

---

## Forms (React Hook Form + Zod)

- Define the Zod schema inline in the component file.
- Pass the schema to `zodResolver` in `useForm`.
- `JobForm` is the canonical example: handles both create (`POST /jobs`) and edit (`PATCH /jobs/:id`) in a single component. `isEdit = !!job`.
- Reset form on modal open via `useEffect([open, job])` — this ensures stale values don't persist when reopening.

---

## Key Components

See `frontend/COMPONENTS.md` for per-component reference (`JobForm`, `ResumeUpload`, `InterviewRounds`, `KanbanBoard`, `Sidebar`, `providers.tsx`).

---

## Utility Functions (`lib/utils.ts`)

| Function               | Usage                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| `cn(...classes)`       | Merge Tailwind classes with conflict resolution (clsx + tailwind-merge) |
| `formatDate(date)`     | `'MMM d, yyyy'` — e.g. `Jun 9, 2026`                                    |
| `formatRelative(date)` | `'2 days ago'` style (date-fns `formatDistanceToNow`)                   |

---

## Environment Variables

| Variable              | Required | Notes                                          |
| --------------------- | -------- | ---------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Yes      | Backend base URL, e.g. `http://localhost:3001` |

---

## Adding a New Page

1. Create `app/(dashboard)/your-page/page.tsx` (add `'use client'` if it uses hooks/state)
2. Add a nav entry in `components/layout/sidebar.tsx` if it should appear in the sidebar
3. Use `useQuery` for data fetching — define a new query key following the `['resource', filters]` pattern
4. Use `useMutation` for writes — always invalidate affected query keys on `onSuccess`
5. Show `<Skeleton>` components while loading, not spinners (keeps layout stable)
6. The page is automatically protected by `proxy.ts` — no extra auth checks needed

---

## Playwright E2E Tests (`e2e/`)

- Tests run against the live dev server (`http://localhost:3000`) and live backend
- `e2e/fixtures.ts` sets up shared page fixtures
- Specs: `auth.spec.ts`, `dashboard.spec.ts`, `jobs.spec.ts`, `profile.spec.ts`
- Run with: `npx playwright test` (requires both servers running)

