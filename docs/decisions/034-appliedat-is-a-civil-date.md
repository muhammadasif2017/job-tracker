# ADR-034: `Job.appliedAt` is a civil date, not an instant

## Status
Accepted

## Date
2026-09-03

## Context

A full read of the jobs module — backend service, stats, constants, DTOs, and
the frontend hooks, list, board, form and date helpers together — surfaced one
root cause with five separate symptoms. None of the five is visible from any
single file, which is why three prior review passes (#275, #276, #277) each
fixed a symptom and left the cause.

`Job.appliedAt` was simultaneously two things:

- **A calendar date.** The UI is `<input type="date">`. The CSV export writes
  `.split('T')[0]`. The stats bucket it by day. The list sorts by it. Nobody
  reads a time-of-day off it, and no product question ("when did I apply?")
  has one.
- **A real instant.** The column is `@default(now())`, so every create that
  omits the field — quick-add, the browser extension, any API client — stored
  a full timestamp. ADR-033's `leftWishlist` re-stamp wrote `new Date()`, also
  a full timestamp.

Meanwhile `frontend/lib/utils.ts` documented the column as *"stored as a
UTC-midnight instant representing a calendar date with no real time-of-day
component"* and read UTC getters on the strength of that claim, while ADR-033
had just made `JobsStatsService` resolve the same column in the user's
`User.timezone`, and `buildJobWhere`'s `dateFrom`/`dateTo` compared it against
plain UTC midnights.

Three calendars, one column. For a user in UTC+5 applying at 02:00 local on
Sep 3 (stored `Sep 2 21:00Z`):

| Surface | Reports |
| --- | --- |
| List, board, detail page | Sep 2 |
| `thisMonth` card and trend chart | Sep 3 |
| Filter "applied on Sep 3" | excluded |

And it corrupted data rather than just displaying it wrongly. `JobForm`
prefills `appliedAt` from `job.appliedAt.split('T')[0]` — the same shifted UTC
day — and resends every field on every submit. Editing a job's notes rewrote
its application date backwards by up to a day. The create default,
`new Date().toISOString().split('T')[0]`, dated a new application a day early
for anyone east of UTC before their local morning.

The invariant was already violated on the create path before ADR-033.
ADR-033 did not introduce the violation; it removed the last reason to believe
the invariant and made the shifted case routine.

## Decision

**`Job.appliedAt` holds a civil date: UTC midnight standing in for a calendar
day, never a real time-of-day.** The user's own timezone decides which
calendar day, once, at write time.

Three consequences follow, and they are the whole change:

### 1. Every write path stamps a civil day

`JobsService` has two private helpers and no third way in:
`civilDateFromInput` (a date the client named — floored to the UTC day it
names, so a full ISO datetime can't smuggle a time-of-day past
`@IsDateString`) and `todayFor` (a date we infer — `localCivilDay(now,
user.timezone)`). `create` sets the column explicitly on every path so the
schema's `@default(now())` can never fire.

### 2. No read path re-projects a stored value

`computeTrendBuckets` no longer runs `localCivilDay` over `appliedDates`. The
zone still places the *window* — which day is "today", which day a rolling
30d/90d cutoff lands on — but resolving an already-civil value through a zone
a second time reads UTC midnight back as the previous day for anyone west of
UTC and shifts every bar. `startOfLocalMonth` (a real instant) is replaced by
`startOfCivilMonth` (a civil one), and `rangeToCutoff` counts back in whole
civil days instead of subtracting milliseconds from `now`, which had been
carrying the current time-of-day into a bound compared against midnights.

### 3. The frontend names the distinction

`formatDateOnly` is now `formatCivilDate`, and its doc comment says which
fields it is for and which it is not. `nextInterviewAt` and
`InterviewRound.scheduledAt` are **real instants** — an interview happens at a
time, the attention list filters them on a 48-hour window, reminder emails
schedule off them — and now render through `formatDate`, which reads local
getters. They had been rendering through the UTC-getter formatter on the
strength of the same false comment.

## Consequences

- The "this month" boundary and the rolling-range cutoffs are still
  timezone-aware; ADR-033's insight there was correct. What's reverted is
  applying a zone to values *read out of the column*, which only became wrong
  once the column's semantics were pinned down.
- `zonedInstantFromCivil` and `civilMsIn` are gone from `timezone.util.ts`.
  Nothing needs a civil→instant conversion any more: every civil value in the
  system now stays civil end to end. `NotificationsScheduler` keeps its own
  `Intl` helpers and is untouched.
- `appliedAtUpperBound` keeps widening a date-only `dateTo` to an exclusive
  start-of-next-day even though `lte` would now be equivalent for a civil row.
  Rows written before this ADR carry a real time-of-day, and `lte` would drop
  them from their own day.
- The `leftWishlist` re-stamp guard changed from "the client sent an
  `appliedAt`" to "the client sent one *different from the stored value*".
  `JobForm` resends the untouched pre-filled date on every submit, so the old
  guard meant the re-stamp fired on a kanban drag and silently did not on the
  exact same transition made through the edit form.
- `create` and `update` may issue one extra primary-key read of
  `User.timezone`. On `create` it runs in parallel with the company-FK
  resolution.

## Alternatives considered

### Keep `appliedAt` as a real instant and make every read path zone-aware
Rejected. It is the larger change — the browser would need `User.timezone` to
render a list row, and `buildJobWhere` would need `zonedInstantFromCivil` on
both bounds — and it preserves a time-of-day that no product question asks
for and no surface displays. Storing precision the domain doesn't have is what
created the ambiguity in the first place.

### Change the column's Prisma type to `@db.Date`
Rejected for now. It is the honest schema, and it would make the invariant
unbreakable rather than merely enforced by two helpers. But it is a migration
against the shared dev database that e2e runs live against, and the
application-level fix delivers the correctness now. Worth revisiting as a
standalone change.

### Backfill existing rows
Deliberately not done. Rows written before this ADR keep their real
timestamps and display on their UTC day, which is what they did before —
consistently wrong rather than newly wrong. They normalize on the next edit.
A backfill would need a per-user timezone projection over historical rows to
guess a calendar day nobody recorded, against the shared dev DB.
