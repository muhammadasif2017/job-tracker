# Key Components Reference

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
- Create/update-outcome/delete mutations all `invalidateQueries(['job', jobId])`,
  `['job-events', jobId]`, `['attention']`, `['jobs']`, `['stats']`, and
  `['analytics', 'funnel']` — no optimistic updates (simpler than
  `KanbanBoard`'s pattern; this isn't a drag interaction needing instant feedback).
  The last three match the manual status-change mutation's invalidation set
  (`jobs/[id]/page.tsx`) because creating a round can silently flip `Job.status`
  (APPLIED -> INTERVIEWING auto-promotion) — without them the Kanban board and
  dashboard stats show a stale status until the next unrelated refetch.
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
