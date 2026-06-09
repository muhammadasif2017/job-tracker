@AGENTS.md

# Frontend CLAUDE.md

## Commands

```bash
npm run dev        # Next.js dev server on :3000
npm run build      # production build
npm run lint       # ESLint
```

---

## Project Structure

```
frontend/
├── proxy.ts                    # Route guard (Next.js 16 middleware — NOT middleware.ts)
├── app/
│   ├── layout.tsx              # Root layout — wraps everything in <Providers>
│   ├── globals.css
│   ├── (auth)/                 # Route group — adds NO path segment
│   │   ├── login/page.tsx      # → /login
│   │   ├── register/page.tsx   # → /register
│   │   └── callback/page.tsx   # → /callback  (OAuth landing)
│   └── (dashboard)/            # Route group — adds NO path segment
│       ├── layout.tsx          # Sidebar + top header shell
│       ├── page.tsx            # → /  (dashboard home)
│       ├── jobs/
│       │   ├── page.tsx        # → /jobs  (list + kanban)
│       │   └── [id]/page.tsx   # → /jobs/:id  (detail + timeline)
│       └── profile/page.tsx    # → /profile
├── components/
│   ├── providers.tsx           # QueryClientProvider + Toaster
│   ├── layout/
│   │   ├── sidebar.tsx         # Nav links + logout
│   │   └── theme-toggle.tsx
│   ├── auth/
│   │   └── oauth-button.tsx    # Google / GitHub OAuth buttons
│   ├── dashboard/
│   │   ├── stats-card.tsx
│   │   └── status-chart.tsx    # Recharts pie/bar chart
│   ├── jobs/
│   │   ├── job-form.tsx        # Shared create/edit modal form
│   │   └── kanban-board.tsx    # Drag-and-drop board (@hello-pangea/dnd)
│   └── ui/                     # Generic primitives (Button, Input, Modal, Badge, Skeleton, Spinner)
├── lib/
│   ├── api.ts                  # Axios instance + request/response interceptors
│   ├── auth.ts                 # tokenStorage — localStorage wrapper for JWTs
│   └── utils.ts                # cn(), formatDate(), formatRelative()
├── store/
│   └── auth.store.ts           # Zustand auth state (user, isAuthenticated, accessToken)
└── types/
    └── index.ts                # All shared TypeScript types and constants
```

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

Pure `localStorage` wrapper. Keys: `jt_access`, `jt_refresh`. Only the Axios interceptor should read/write these directly.

### `store/auth.store.ts` — Zustand store

Persisted to `localStorage` under key `jt-auth`. Exposes:

| Method | What it does |
|---|---|
| `setAuth(user, accessToken, refreshToken)` | Writes to tokenStorage, sets `jt_authed` cookie (7d, SameSite=Lax), updates state |
| `setUser(user)` | Updates user profile without touching tokens — used after profile edit |
| `logout()` | Clears tokenStorage, expires cookie, resets state |

**Always call `setAuth` after a successful login/OAuth/register** — it's the single place that syncs all three layers (tokenStorage, cookie, Zustand).

---

## Axios Instance (`lib/api.ts`)

Base URL from `NEXT_PUBLIC_API_URL`.

### Request Interceptor

Attaches `Authorization: Bearer <token>` unless the caller already set it. The manual header override is used when fetching `/auth/me` immediately after login (before the token is persisted).

### Response Interceptor — Refresh + Queue

Handles concurrent 401s without duplicate refresh calls:

1. First 401: marks `isRefreshing = true`, POSTs to `/auth/refresh`.
2. Subsequent 401s while refreshing: queued in `failedQueue`.
3. On refresh success: drains queue, retries all queued requests with new token.
4. On failure or no refresh token: clears storage, expires cookie, `window.location.href = '/login'`.

`/auth/login` and `/auth/register` 401s bypass this and surface directly to the caller.

---

## Types (`types/index.ts`)

Single source of truth for all shared types and UI constants:

| Export | Type |
|---|---|
| `JobStatus` | Union: `'WISHLIST' \| 'APPLIED' \| 'INTERVIEWING' \| 'OFFER' \| 'REJECTED' \| 'GHOSTED'` |
| `Job`, `JobEvent`, `User`, `AuthTokens` | Core domain interfaces |
| `JobStats` | `{ total, byStatus, thisMonth, responseRate }` |
| `PaginatedJobs` | `{ data: Job[], meta: { total, page, limit, totalPages } }` |
| `JOB_STATUSES` | Ordered array of all statuses |
| `STATUS_LABELS` | Human-readable labels per status |
| `STATUS_COLORS` | Tailwind classes per status (for `<StatusBadge>`) |
| `STATUS_DOT_COLORS` | Hex colors per status (for Kanban column dots and charts) |

---

## Data Fetching Conventions (TanStack Query v5)

- Global defaults: `staleTime: 60_000`, `retry: 1` (set in `components/providers.tsx`).
- Query key pattern:
  - `['stats']` — dashboard stats
  - `['jobs', filters]` — paginated job list (filters object is part of the key)
  - `['job', id]` — single job detail
  - `['job-events', id]` — timeline events for a job
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
- On success: invalidates `['jobs']`, `['stats']`, and `['job', job.id]` (edit only)
- URL field: empty string is sent as `undefined` to the API (backend requires valid URL or nothing)

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

| Function | Usage |
|---|---|
| `cn(...classes)` | Merge Tailwind classes with conflict resolution (clsx + tailwind-merge) |
| `formatDate(date)` | `'MMM d, yyyy'` — e.g. `Jun 9, 2026` |
| `formatRelative(date)` | `'2 days ago'` style (date-fns `formatDistanceToNow`) |

---

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Backend base URL, e.g. `http://localhost:3001` |

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
