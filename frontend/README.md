# Job Tracker — Frontend

Next.js 16 (App Router) frontend for the Job Tracker project. See the [root README](../README.md) for full setup and Docker instructions.

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build
npm run lint     # ESLint
```

## Environment

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Architecture notes

**Routing**

- `proxy.ts` (not `middleware.ts`) exports `proxy` (not `middleware`) — Next.js 16 convention. Reads the `jt_authed` cookie to redirect unauthenticated users to `/login`.
- Route groups `(auth)` and `(dashboard)` add no path segments. `/app/(auth)/callback/page.tsx` → `/callback`.

**Auth state — two layers**

- `lib/auth.ts` — `tokenStorage` reads/writes `localStorage` keys `jt_access` / `jt_refresh`. Used by the Axios interceptor to attach Bearer tokens.
- `store/auth.store.ts` — Zustand + persist for `user` and `isAuthenticated`. Manages the `jt_authed` cookie (set on login, cleared on logout) which `proxy.ts` reads.

**API client (`lib/api.ts`)**

- Axios instance with a request interceptor that attaches the Bearer token.
- Response interceptor queues 401s, calls `POST /auth/refresh`, retries queued requests. Redirects to `/login` on refresh failure.

**OAuth callback (`app/(auth)/callback/page.tsx`)**

- Receives a short-lived `?code=` param from the backend redirect.
- POSTs to `/auth/exchange-code` to obtain tokens, then fetches the user profile.

**Data fetching**

- TanStack Query v5 with `staleTime: 60_000`.
- Query keys: `['jobs', filters]`, `['job', id]`, `['job-events', id]`, `['stats']`.
- Mutations invalidate related keys on success.

**Forms**

- React Hook Form + Zod. `JobForm` handles both create (`POST /jobs`) and edit (`PATCH /jobs/:id`).
