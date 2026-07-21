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

Also used by `app/(auth)/callback/page.tsx` to POST `/auth/exchange-code` with the OAuth code — same instance, so the refresh/queue interceptor applies to that call too.

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

---

## Data Fetching Conventions (TanStack Query v5)

- Global defaults: `staleTime: 60_000`, `retry: 1` (set in `components/providers.tsx`).
- Query key pattern:
  - `['stats']` — dashboard stats
  - `['jobs', filters]` — paginated job list (filters object is part of the key)
  - `['job', id]` — single job detail (includes `resume` relation)
  - `['job-events', id]` — timeline events for a job
  - `['resume', jobId]` — resume metadata for a specific job; managed by `ResumeUpload` via `setQueryData` on mutation, not via invalidation
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

### `JobForm`

- `open: boolean`, `onClose: () => void`, `job?: Job` (optional — if present, edit mode)
- On create success: stays open and renders `<ResumeUpload>` so the user can optionally attach a PDF before closing. Closing at that point calls `reset()` + `onClose()`.
- On edit success: invalidates `['jobs']`, `['stats']`, `['job', job.id]`, then closes immediately.
- URL field: empty string is sent as `undefined` to the API (backend requires valid URL or nothing)

### `ResumeUpload`

- Props: `jobId: string | null`, `initialResume?: Resume | null`
- Renders nothing when `jobId` is `null` (safe to render before a job exists).
- Uses `['resume', jobId]` query with `initialData` from the parent — **no extra network request fires on mount** when `initialResume` is provided.
- Upload/remove mutations update the cache via `qc.setQueryData` (not invalidation) so the UI updates without a roundtrip.
- View opens a presigned URL in a new tab. Download fetches the blob client-side and triggers a `<a download>` — this cross-origin-safe approach works for both local and Oracle presigned URLs.
- `GET /jobs/resumes/file` (the URL returned by `LocalStorageService.getPresignedUrl`) is a **dev-only** endpoint — it returns 404 in production (`STORAGE_DRIVER=oracle`). Don't hardcode calls to it.

### `InterviewRounds`

- Props: `jobId: string`, `rounds: InterviewRound[]` — `rounds` comes straight from
  the parent's `['job', id]` query (`job.interviewRounds`), **not** a separate
  query key. The backend embeds rounds in `GET /jobs/:id`.
- Create/update-outcome/delete mutations all `invalidateQueries(['job', jobId])`
  and `invalidateQueries(['attention'])` — no optimistic updates (simpler than
  `KanbanBoard`'s pattern; this isn't a drag interaction needing instant feedback).
  Invalidating `['job', id]` also refreshes `job.nextInterviewAt`, which the
  backend recomputes server-side (see backend `CLAUDE.md`, "nextInterviewAt Is
  Derived") — the UI never sets that field directly.
- Delete uses the same inline confirm-toggle pattern as `ResumeUpload` (`Remove?`
  / Yes / No), not a modal.

### `KanbanBoard`

- Fetches all jobs with `limit=100` (no pagination in board view)
- Only shows 4 columns: `WISHLIST`, `APPLIED`, `INTERVIEWING`, `OFFER` — `REJECTED` and `GHOSTED` are intentionally excluded
- Uses optimistic updates on drag: immediately updates cache, rolls back on error, then invalidates on settle

### `Sidebar`

- Logout: calls `POST /auth/logout` (fire-and-forget), then calls `logout()` from Zustand, then redirects to `/login`. The API call is wrapped in try/catch so a network error doesn't block the client-side logout.

### `providers.tsx`

- `QueryClient` is created inside `useState` so it's stable across re-renders and not recreated on every render.
- `<Toaster>` is placed here so toast notifications work globally.

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

