# Frontend Plan — Job Tracker UI

> Stack: Next.js 16 · React 19 · TypeScript · Tailwind CSS 4

---

## Architecture

```
app/
├── (auth)/                    # Auth route group (no sidebar)
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── callback/page.tsx      # OAuth redirect landing — reads tokens from URL
├── (dashboard)/               # Protected route group (with sidebar layout)
│   ├── layout.tsx             # Sidebar + topbar shell
│   ├── page.tsx               # Dashboard / stats overview
│   ├── jobs/
│   │   ├── page.tsx           # Job list / kanban board
│   │   └── [id]/page.tsx      # Job detail
│   └── profile/page.tsx       # User profile + connected accounts
├── layout.tsx                 # Root layout (fonts, providers)
├── middleware.ts               # Redirect unauthenticated users
└── globals.css

lib/
├── api.ts                     # Axios instance with interceptors
├── auth.ts                    # Token storage helpers
└── utils.ts                   # cn(), date formatting, etc.

hooks/
├── useAuth.ts                 # Auth state + actions
├── useJobs.ts                 # Job CRUD mutations
└── useStats.ts                # Dashboard stats

components/
├── ui/                        # Base components (Button, Input, Badge, Modal, etc.)
├── auth/                      # OAuthButton, SocialDivider
├── jobs/                      # JobCard, JobForm, StatusBadge, KanbanColumn
├── dashboard/                 # StatsCard, StatusChart, ActivityFeed
└── layout/                    # Sidebar, Topbar, ThemeToggle

store/
└── auth.store.ts              # Zustand store for auth state

types/
└── index.ts                   # Shared TS types (Job, User, JobStatus, etc.)
```

---

## Pages & Features

### 1. Authentication

**`/login`**

- Email + password form
- Divider: "or continue with"
- **"Continue with Google"** button → redirects to `API_URL/auth/google`
- **"Continue with GitHub"** button → redirects to `API_URL/auth/github`
- "Remember me" checkbox
- Link to register
- Inline error messages

**`/register`**

- Name, email, password, confirm password
- Same OAuth buttons as login (Google + GitHub)
- Note below OAuth buttons: "Signing up with Google/GitHub skips email verification"
- Client-side + server-side validation feedback

**`/auth/callback` (new)**

- Receives `?accessToken=x&refreshToken=y` from backend OAuth redirect
- Reads tokens from URL search params
- Stores them via `auth.store` (Zustand)
- Clears tokens from URL (`router.replace('/')`)
- Shows a brief loading spinner while redirecting to dashboard
- On error param: shows error message + link back to login

**Middleware (`middleware.ts`):**

- Check JWT in cookie / Zustand store; redirect `/login` if unauthenticated
- Redirect authenticated users away from `/login`, `/register`, `/auth/callback`

---

### 2. Dashboard (`/`)

**Stats cards (top row):**

- Total Applications
- Currently Interviewing
- Offers Received
- Response Rate (%)

**Charts:**

- Donut chart — applications by status (color-coded per status)
- Bar chart — applications per month (last 6 months)

**Recent activity:**

- Last 5 job updates as a timeline list

**Libraries:** Recharts

---

### 3. Jobs Page (`/jobs`)

**Two views (toggle):**

- **List view** — sortable table: Company, Position, Status, Applied Date, Location, Actions
- **Kanban view** — columns per status (WISHLIST → APPLIED → INTERVIEWING → OFFER), cards draggable between columns

**Toolbar:**

- Search input (debounced 300ms, searches company + position)
- Status filter (multi-select dropdown)
- Date range picker
- Sort by dropdown
- Add Job button (opens modal)

**Empty state:** Illustrated empty state with CTA.

**Libraries:** `@hello-pangea/dnd` for kanban drag-and-drop

---

### 4. Job Form (Add / Edit)

Modal (from list) or side panel (from detail).

**Fields:**

- Company name (required)
- Position / Job title (required)
- Location (optional)
- Job URL (optional, opens in new tab)
- Status (select with color-coded options)
- Applied date (date picker, defaults to today)
- Notes (textarea)

**Libraries:** React Hook Form + Zod

---

### 5. Job Detail (`/jobs/[id]`)

- Full job info layout
- Inline status change (dropdown)
- Edit / Delete actions
- Notes section with edit capability
- "Open job URL" button
- Back navigation

---

### 6. Profile Page (`/profile`)

- Avatar from OAuth provider (if available)
- Update name form
- Change password form — **hidden if user has no password** (OAuth-only account)
- **Connected Accounts section:**
  - Shows Google / GitHub with connected indicator
  - "Connect" button for unlinked providers (links via OAuth flow)
- Danger zone: Delete account (confirmation dialog)

---

## UI/UX Details

### Theme

- **Dark mode default**, light mode toggle
- Colors: Slate-based neutral palette, accent indigo/violet
- Stored in `localStorage`, applied via `data-theme` on `<html>`

### Design System (Tailwind 4)

| Component     | Description                                 |
| ------------- | ------------------------------------------- |
| `Button`      | variants: primary, secondary, ghost, danger |
| `OAuthButton` | Google / GitHub branded button with icon    |
| `Input`       | with label, error state, helper text        |
| `Badge`       | color-coded per `JobStatus`                 |
| `Modal`       | accessible dialog (Radix Dialog)            |
| `Dropdown`    | select / combobox (Radix Select)            |
| `Spinner`     | loading indicator                           |
| `Toast`       | success / error notifications (Sonner)      |
| `Skeleton`    | loading placeholder for cards and rows      |
| `Tooltip`     | on icon buttons                             |

**Primitives:** `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-dropdown-menu`

### Responsive

- Mobile: single-column, bottom nav bar
- Tablet: sidebar collapses to icon-only
- Desktop: full sidebar always visible

---

## Data Fetching

**TanStack Query v5:**

- `useQuery` for jobs list, stats, job detail
- `useMutation` for create, update, delete
- Optimistic updates on status change and delete
- Cache invalidation on mutations

**Axios instance (`lib/api.ts`):**

- Base URL from `NEXT_PUBLIC_API_URL`
- Request interceptor: attach `Authorization: Bearer <accessToken>`
- Response interceptor: on 401, attempt silent refresh; on failure, logout + redirect `/login`

---

## State Management

**Zustand (`store/auth.store.ts`):**

- `user`, `accessToken`, `isAuthenticated`
- `login()`, `logout()`, `setTokens()` actions
- Persisted to `localStorage`

---

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

No OAuth keys needed on the frontend — the browser is simply redirected to the backend URL which handles the provider handshake.

---

## Implementation Order

1. Install libraries, configure Axios + Zustand
2. `types/index.ts` — shared types
3. Base UI components (Button, Input, Badge, Modal, OAuthButton)
4. Auth pages (login + register with OAuth buttons) + `/auth/callback` + middleware
5. Dashboard layout (sidebar + topbar)
6. Dashboard page (stats cards + charts)
7. Jobs list view + search/filter/sort
8. Add/Edit job modal + form
9. Job detail page
10. Kanban board + drag-and-drop
11. Profile page (with connected accounts section)
12. Dark/light mode toggle
13. Responsive polish
14. Loading states, skeletons, empty states, toasts

---

## Dependencies to Install

```bash
# Data fetching & state
npm install @tanstack/react-query axios zustand

# Forms & validation
npm install react-hook-form zod @hookform/resolvers

# UI primitives
npm install @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-dropdown-menu @radix-ui/react-tooltip

# Charts
npm install recharts

# Kanban drag-and-drop
npm install @hello-pangea/dnd

# Notifications
npm install sonner

# Date utilities
npm install date-fns

# Class merging utility
npm install clsx tailwind-merge
```
