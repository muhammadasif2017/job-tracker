# Spec: Response Insights

## Objective

In the Pakistan job market almost no company replies to an application. Silence
*is* the rejection — an explicit "we rejected you" arrives maybe 1% of the time.
The app today handles this poorly:

- Dead applications sit in `APPLIED` / `INTERVIEWING` forever unless the user
  remembers to drag them to `GHOSTED`, which skews every rate on the dashboard.
- `responseRate` counts a job's *current* status, so a job that reached
  `INTERVIEWING` and then went silent (`GHOSTED`) counts as "no reply".
- Response rate is split by application channel only, and there is no measure
  of how long replies actually take.

A structured rejection-reason field was considered and dropped: with ~1% of
rejections being explicit, it would stay empty. The job's existing `notes`
field covers the rare explicit reason.

**User stories:**
- As a user, when an application has had no activity for 14 days, the app
  suggests marking it ghosted — on the dashboard and as a badge on the job in
  the list and kanban views. It never changes the status on its own.
- As a user, I can accept a suggestion (status becomes `GHOSTED`) or dismiss it
  ("HR said wait"), which hides it — and the job's dashboard follow-up nudges —
  until another 14 days pass with no activity.
- As a user, I can mark every job currently listed on the "Looks ghosted" card
  as ghosted in one action, after a confirmation.
- As a user, I can see which discovery sources and which application channels
  actually get replies, counting any job that ever got a reply.
- As a user, I can see the median days until a reply, and what share of replies
  came after 14 days — so I can tell whether 14 days is the right cutoff.

**Out of scope:** automatic status changes, email/digest delivery of ghost
suggestions, structured rejection reasons, company-level (city/industry/size)
and week-over-week breakdowns.

## Definitions

- **Ghost suggestion** — a job is suggested when all hold:
  - `status` is `APPLIED` or `INTERVIEWING`
  - `appliedAt` is more than 14 days ago
  - no `JobEvent` (any type, including `INTERVIEW_ROUND_ADDED`) in the last 14 days
  - `ghostSuggestionDismissedAt` is null or more than 14 days ago
  - `nextInterviewAt` is null or in the past — a scheduled interview is not silence
- **Replied** — the job's event history ever reached `INTERVIEWING`, `OFFER`, or
  `REJECTED` (after the existing funnel rollup, so `APPLIED -> OFFER` counts).
  A job now `GHOSTED` after an interview still counts as replied. A job
  *created* directly as `REJECTED` (or another replied status) counts as replied.
- **Days until reply** — from `appliedAt` to the first event reaching a replied
  status. Jobs *created* directly in a replied status are excluded from timing
  (but not from the replied count): their event timestamp is when the row was
  added, not when the company answered.

## Tech Stack

Existing stack only — NestJS + Prisma 7 backend, Next.js + TanStack Query
frontend. No new dependencies.

## Design

### Backend

1. **Schema (additive, no data loss):** `Job.ghostSuggestionDismissedAt DateTime?`.
   Hand-written migration SQL + `prisma migrate deploy` (Prisma migrate is
   non-interactive here; keep the raw trigram indexes intact), then
   `prisma generate`. Declare "no data loss" for `npm run check:migrations`.
2. **`ghost-suggestions.helper.ts`** (jobs module, beside `attention.helper.ts`):
   `getGhostSuggestions(prisma, userId)` returns `{ since, job }[]`, oldest
   `since` first, where `since` = last activity (latest event, dismissal, or
   `appliedAt`). Kept **separate from `getAttentionItems`** on purpose: the
   digest email reads `getAttentionItems`, and ghost suggestions must not reach
   email, nor change the digest's `STALE_*` dedup.
3. **Endpoints** (`jobs.controller.ts`, declared before `:id` routes):
   - `GET /jobs/ghost-suggestions` → `GhostSuggestionDto[]`
   - `POST /jobs/:id/ghost-suggestion/dismiss` → stamps
     `ghostSuggestionDismissedAt = now`, owner-scoped, 404 for another user's job.
   - "Mark ghosted" reuses the existing `PATCH /jobs/:id` with `status: GHOSTED`
     (writes the normal `STATUS_CHANGE` event).
   - `POST /jobs/ghost-suggestions/mark-ghosted` with body `{ jobIds: string[] }`
     (non-empty, capped, cuid-validated) → `{ updated: number }`. The server
     intersects `jobIds` with the user's *current* suggestions, so it only marks
     jobs the user saw that are still eligible — a job that got activity or was
     dismissed in the meantime is skipped, and another user's ids never match.
     Each marked job goes through the same status-change path as `PATCH`
     (`STATUS_CHANGE` event and any side effects that path already triggers),
     not a raw `updateMany` that would skip the event.
4. **`GET /jobs/attention`** (dashboard only, not the digest), filtered in
   `JobsStatsService.getAttention`, not in `getAttentionItems`:
   - drops jobs that are currently ghost-suggested, so one job never shows in
     both cards;
   - drops `STALE_APPLIED` / `STALE_INTERVIEWING` items whose
     `ghostSuggestionDismissedAt` is within the last 14 days. `UPCOMING_INTERVIEW`
     is never hidden. The digest email ignores dismissals.
5. **Analytics** (`jobs-stats.service.ts`):
   - `getStats.responseRate` and the per-channel rates switch to the event-based
     *Replied* definition. `ghostRate` stays current-status. The two can now sum
     past 100% (a job can reply, then go ghosted) — intended.
   - **How "Replied" is computed.** Today both rates come from
     `groupBy(status)`, which only sees current status. Replace the
     "responded" side with a relation filter so it stays a DB aggregate, with
     no in-memory event scan added to the dashboard-mount path:
     ```ts
     // shared in jobs.constants.ts
     export const REPLIED_FILTER = {
       OR: [
         { status: { in: [...RESPONDED_STATUSES] } }, // legacy rows with no events
         { events: { some: { toStatus: { in: [...RESPONDED_STATUSES] } } } },
       ],
     };
     ```
     `getStats`: one extra `job.count({ where: { ...rangeWhere, ...SENT_APPLICATION_FILTER, ...REPLIED_FILTER } })`.
     `getFunnel`: two `groupBy({ by: ['applicationChannel', 'discoverySource'] })`
     calls (all sent / sent + `REPLIED_FILTER`), folded in memory into both
     breakdowns. `INTERVIEW_ROUND_ADDED` carries the job's current status as
     `toStatus`, so it never marks an `APPLIED` job as replied.
   - `replyTiming` reuses the events `getFunnel` already loads (ordered by
     `[jobId, createdAt]`) plus `appliedAt` from one `job.findMany` selecting
     `{ id, appliedAt }` for in-range sent jobs.
   - `getFunnel` adds `responseRateByDiscoverySource` (same shape as
     `responseRateBySource`, keyed by `DiscoverySource | 'UNSPECIFIED'`).
     Existing `responseRateBySource` (channel) keeps its name for compatibility.
   - `getFunnel` adds `replyTiming: { repliedCount, medianDays, repliedAfter14DaysPercent }`
     (`medianDays` null when `repliedCount` is 0).

### Frontend

1. `features/jobs/hooks.ts` (or `features/dashboard/hooks.ts`):
   `useGhostSuggestionsQuery`, `useDismissGhostSuggestion`; marking ghosted
   reuses the existing status mutation. Both mutations invalidate
   `['ghost-suggestions']`, `['attention']`, `['jobs']`, and stats keys.
2. **Dashboard:** new "Looks ghosted" card listing suggestions, each row with
   **Mark ghosted** and **Dismiss** buttons; empty state when none. A
   **Mark all ghosted (N)** button in the card header opens a confirm dialog
   naming the count, then sends the listed job ids. After success, show
   "Marked N as ghosted" (N from the response, which may be lower than listed).
3. **Jobs list + kanban:** a "No reply 14d+" badge on suggested jobs, built from
   the same query as a `Set` of job ids (no change to the jobs list API). Same
   two actions available on the badge.
4. **Funnel chart:** add a response-rate-by-discovery-source chart beside the
   channel one, and a reply-timing stat ("Median reply: 6 days · 18% of replies
   after 14 days").

## Commands

```bash
# Task end, in the package touched (types, lint, tests with coverage; + next build on frontend)
cd backend && npm run check:task
cd frontend && npm run check:task

# Backend e2e (live DB)
cd backend && npm run test:e2e

# Repo root
npm run check:floor        # suppressions, TODOs, weakened tests
npm run check:migrations   # migration declares -- data-loss:
node scripts/coverage-diff.mjs  # >= 80% of changed lines covered
```

## Project Structure

```
backend/prisma/schema.prisma                       # + ghostSuggestionDismissedAt
backend/prisma/migrations/<ts>_job_ghost_dismissed/ # hand-written, additive
backend/src/modules/jobs/
  ghost-suggestions.helper.ts                      # new
  jobs.controller.ts                               # + 2 routes
  jobs.service.ts                                  # + dismissGhostSuggestion
  jobs-stats.service.ts                            # replied definition, new fields
  dto/ghost-suggestion.dto.ts                      # new
  dto/funnel-stats.dto.ts                          # + discovery source, replyTiming
frontend/
  types/index.ts                                   # + GhostSuggestion, FunnelStats fields
  features/dashboard/hooks.ts                      # + query/mutation hooks
  components/dashboard/ghost-suggestions-card.tsx  # new
  components/dashboard/funnel-chart.tsx            # + source chart, timing stat
  components/jobs/kanban-board.tsx                 # + badge
  app/(dashboard)/jobs/page.tsx                    # + badge in list view
  app/(dashboard)/page.tsx                         # + card
```

## Delivery Slices

The file list above is 16 files; the manual review limit is 10 per PR. Four PRs,
in order. Ghost suggestions and the Replied change share no code, so slices 3–4
can go before or after 1–2.

| # | Slice | Files (approx.) | Notes |
|---|-------|-----------------|-------|
| 1 | Ghost suggestions — backend | schema, migration, helper, dtos, controller, service, stats service (attention filter), specs | **Only migration in the feature.** Merging it migrates prod — confirm before merge. If it passes 10 files, split: 1a migration + suggestions + dismiss, 1b bulk mark + attention filter. |
| 2 | Ghost suggestions — frontend | types, hooks, card, dashboard page, kanban, jobs page, tests | Depends on 1 being deployed. |
| 3 | Replied definition + analytics — backend | constants, stats service, funnel dto, specs | Existing stats spec expectations change; call it out in the PR. |
| 4 | Analytics — frontend | types, funnel-chart, tests | Depends on 3. |

## Code Style

Follow the existing attention helper: Prisma `findMany` with an
`events: { none: { createdAt: { gt: cutoff } } }` recency test, a named cutoff
constant, and a comment explaining *why* each clause exists.

```ts
const GHOST_AFTER_DAYS = 14;

prisma.job.findMany({
  where: {
    userId,
    status: { in: [JobStatus.APPLIED, JobStatus.INTERVIEWING] },
    appliedAt: { lt: cutoff },
    events: { none: { createdAt: { gt: cutoff } } },
    AND: [
      { OR: [{ ghostSuggestionDismissedAt: null }, { ghostSuggestionDismissedAt: { lt: cutoff } }] },
      { OR: [{ nextInterviewAt: null }, { nextInterviewAt: { lt: now } }] },
    ],
  },
});
```

## Testing Strategy

- **Backend unit (Jest, `*.spec.ts`):** each ghost-rule clause has a passing and
  a failing case (13 vs 15 days, recent event, recent dismissal, old dismissal,
  future interview, `WISHLIST`/`OFFER` never suggested). Replied definition:
  `INTERVIEWING -> GHOSTED` counts as replied; `APPLIED -> OFFER` counts; job
  created as `REJECTED` excluded from timing. Median with odd/even counts and
  zero replies.
- **Backend e2e:** dismiss endpoint is owner-scoped (other user → 404); attention
  endpoint excludes suggested jobs; digest output unchanged.
- **Frontend (Vitest + Testing Library, `*.test.tsx`):** card renders rows,
  empty state, both buttons call the right mutation; badge appears only for
  suggested ids in list and kanban views.
- **Coverage gate:** ≥ 80% of changed executable lines per PR
  (`coverage-diff.mjs`); project coverage ratchets must not fall.
- **Playwright:** one flow — suggested job on dashboard → Mark ghosted → gone
  from card, status `GHOSTED`.

## Boundaries

- **Always:** follow `CONSTRAINTS.md`; run the commands above before each commit;
  owner-scope every new query by `userId`; keep PRs within the 10-file review
  limit.
- **Ask first:** applying the migration to the shared dev DB; merging the
  migration PR (merge migrates prod automatically); any change to the digest
  email or `getAttentionItems`.
- **Never:** change a job's status without a user click; weaken existing stats
  tests to make the new definition pass — update their expectations explicitly
  and say so in the PR.

## Success Criteria

- [ ] A job in `APPLIED` with `appliedAt` 15 days ago and no events in 14 days
      appears in `GET /jobs/ghost-suggestions`; at 13 days it does not.
- [ ] A job with a pending interview in the future is never suggested.
- [ ] Dismiss hides the job; it reappears only after 14 more days with no activity.
- [ ] Mark ghosted sets `GHOSTED`, writes a `STATUS_CHANGE` event, and removes
      the job from the card and badge without a page reload.
- [ ] After a dismiss, the job's `STALE_*` items are absent from `GET /jobs/attention`
      for 14 days, and still present in the digest.
- [ ] Mark all ghosted with 3 listed ids, one of which got a new event since,
      returns `{ updated: 2 }` and writes 2 `STATUS_CHANGE` events; ids owned by
      another user are ignored.
- [ ] A suggested job does not also appear in the dashboard "Needs Attention"
      card; digest email content is unchanged.
- [ ] A job that went `APPLIED -> INTERVIEWING -> GHOSTED` counts as replied in
      `responseRate` and in both per-source breakdowns.
- [ ] Dashboard shows response rate by discovery source, and median days to reply
      plus % of replies after 14 days.
- [ ] Migration is additive; `check:migrations` and `check:floor` pass.

## Decisions

1. **Dismiss quiets dashboard follow-up nudges too** (user, 2026-09-14): a
   dismissed job is hidden from `STALE_*` items in Needs Attention for 14 days.
   Digest email unchanged.
2. **Bulk "Mark all ghosted"** (user, 2026-09-14): included, confirm-gated,
   server re-validates eligibility.
3. **Stats range (default):** reply timing and discovery-source rates
   follow the existing date-range selector (filtered by `appliedAt`), like the
   other funnel metrics.
