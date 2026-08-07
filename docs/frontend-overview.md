# Frontend Overview

## Routing & Auth Guard (`proxy.ts`)

Next.js 16 renamed `middleware.ts` → `proxy.ts` and `middleware()` → `proxy()`. Runs on every request (except static assets via `matcher`).

Reads the `jt_authed` cookie:
- No cookie + private route → redirect to `/login`
- Cookie present + public route (not `/callback`) → redirect to `/`

The cookies are **routing and role signals only**. The access token lives in `localStorage`; the refresh token is an HttpOnly `jt_refresh` cookie set by the backend and is invisible to JavaScript and the proxy.

---

## Route Structure

```
app/
├── layout.tsx                    # Root layout — wraps everything in <Providers>
├── (auth)/                       # Route group — no path segment added
│   ├── login/page.tsx            # → /login
│   ├── register/page.tsx         # → /register
│   └── callback/page.tsx         # → /callback  (OAuth landing)
└── (dashboard)/                  # Route group — no path segment added
    ├── layout.tsx                # Sidebar + header shell
    ├── page.tsx                  # → /  (dashboard home)
    ├── jobs/
    │   ├── page.tsx              # → /jobs
    │   └── [id]/page.tsx         # → /jobs/:id
    └── profile/page.tsx          # → /profile
```

---

## Auth State — Two Layers

### Layer 1 — `lib/auth.ts` (tokenStorage)

Pure `localStorage` wrapper. Key: `jt_access`. The Axios interceptor reads the access token here; the refresh token is never stored in browser JavaScript.

### Layer 2 — `store/auth.store.ts` (Zustand)

Stores `{ user, isAuthenticated }`, persisted to `localStorage` under key `jt-auth`. The access token is kept separately by `tokenStorage`.

- **`setAuth(user, accessToken)`** — writes the access token to `tokenStorage`, sets the non-sensitive `jt_authed` and `jt_role` cookies (7 days, SameSite=Lax, Secure on HTTPS), and updates state. The backend sets the refresh cookie during login or registration.
- **`logout()`** — clears `tokenStorage`, expires routing cookies, and resets state. The sidebar calls `POST /auth/logout` before invoking this local cleanup.
- **`setUser(user)`** — updates user profile without touching tokens.

The cookie is the bridge: Zustand writes it, the proxy reads it.

---

## Axios Instance (`lib/api.ts`)

Base URL is `NEXT_PUBLIC_API_URL`.

### Request Interceptor

Attaches `Authorization: Bearer <token>` from `tokenStorage` unless the caller already set that header. The manual header override is used in auth flows (login, OAuth callback) to fetch `/auth/me` with a brand-new token before it is stored.

### Response Interceptor — Token Refresh with Queue

Handles concurrent 401s gracefully:

1. On any 401 (not already retrying, not an auth endpoint): mark `isRefreshing = true`, call `POST /auth/refresh`.
2. Other 401s arriving while refreshing are pushed into `failedQueue`.
3. On refresh success: drain queue (resolve all with new token), retry original request.
4. On definitive refresh failure: clear local access-token storage, expire routing cookies, and redirect to `/login`. The browser sends the HttpOnly refresh cookie automatically because the Axios instance uses `withCredentials`.

Auth endpoints (`/auth/login`, `/auth/register`) bypass this logic — their 401s surface directly to the caller.

---

## Pages

### `/login`

React Hook Form + Zod schema. On submit:
1. `POST /auth/login` → `{ accessToken }` plus an HttpOnly `jt_refresh` cookie
2. `GET /auth/me` with new token → user profile
3. `setAuth(user, accessToken)` → sets routing cookies and stores the access token
4. Redirect to `/`

### `/register`

Same pattern as login but calls `POST /auth/register`; the backend also sets the HttpOnly refresh cookie.

### `/callback` (OAuth landing)

1. Read `?code=` from URL
2. `POST /auth/exchange-code` → `{ accessToken }` plus an HttpOnly refresh cookie
3. `GET /auth/me` → user profile
4. `setAuth(...)` → redirect to `/`

The `code` is a UUID that expires in 60s server-side. Avoids putting tokens in the URL.

### `/` (Dashboard)

TanStack Query fetches these resources in parallel on mount:
- `GET /jobs/stats?range=90d` → key `['stats', '90d']`
- `GET /jobs/stats/funnel?range=90d` → key `['analytics', 'funnel', '90d']`
- `GET /jobs/stats/trend?range=90d` → key `['analytics', 'trend', '90d']`
- `GET /jobs?limit=5&sortBy=createdAt` → key `['jobs', { limit: 5, sortBy: 'createdAt' }]`

Renders stat cards, a Recharts status distribution chart, and a recent jobs list.

### `/jobs`

Client state: `search`, `statusFilter`, `page`, `view` (list | kanban).

- Search is debounced 300ms before updating the query key to avoid a request per keystroke.
- `useMutation` for delete — invalidates `['jobs']` and `['stats']` on success.
- Export: fetches `/jobs/export` as a blob, creates a temporary `<a>` element, triggers download, revokes the object URL.
- `JobForm` modal is shared for both create and edit.

### `JobForm` Component

Single component for create and edit. `isEdit = !!job`.

- `useEffect` on `[open, job]` resets form fields when the modal opens (pre-fills for edit, clears for create).
- On submit: `PATCH /jobs/:id` if editing, `POST /jobs` if creating.
- Invalidates `['jobs']`, `['stats']`, and `['job', id]` on success.

---

## Data Fetching Conventions

- **TanStack Query v5** with `staleTime: 60_000` ms.
- Query key pattern: `['jobs', filters]`, `['job', id]`, `['job-events', id]`, `['stats', range]`, and `['analytics', metric, range]`.
- Mutations always invalidate related query keys on success.
- Loading states use `<Skeleton>` components (not spinners) for layout-stable placeholders.

---

## Data Flow

```
User action
  → React Hook Form (Zod validation)
  → api.ts Axios (attach Bearer token)
  → proxy.ts (route protection via cookie)
  → Backend API
  → TanStack Query cache (invalidated on mutations)
  → UI re-render
```
