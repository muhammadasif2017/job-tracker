# ADR-033: Date the application, not the save; measure stages by status changes; let the database enforce company uniqueness

## Status
Accepted

## Date
2026-09-03

## Context

A review of the jobs feature found that the tracking side (CRUD, kanban,
timeline, parsing, enrichment, attention) held up, but four defects sat in the
layer that *measures* it — plus two structural costs that the code comments
described accurately without naming the cheaper alternative.

### 1. `appliedAt` was the date a job was saved, not applied to

`Job.appliedAt` is `@default(now())`, and the only writers were `create` and an
explicit `appliedAt` on `PATCH`. Nothing moved it when a job left `WISHLIST`.
`jobs.constants.ts` already reasoned about wishlist rows polluting
`appliedAt`-scoped metrics and solved it by *excluding* `WISHLIST`
(`SENT_APPLICATION_FILTER`) — but said nothing about what happens once the job
leaves that status and re-enters every metric carrying its save date.

Applying today to a job wishlisted in June was therefore reported as an
application made in June: absent from `thisMonth`, plotted on June's trend bar,
outside a 30d range filter, wrong in the CSV "Applied Date" column, and sorted
to the bottom of the default `appliedAt desc` list.

### 2. STALE_APPLIED tested the application date, not movement

`attention.helper.ts` documented the rule as "APPLIED jobs with no movement for
7 days" but queried `{ status: APPLIED, appliedAt: { lt: sevenDaysAgo } }`. The
sibling STALE_INTERVIEWING rule six lines above already used the correct
event-recency test. So a job followed up on yesterday still nagged as stalled —
and combined with (1), a long-wishlisted job would be flagged "stalled for 90
days" the instant it was applied to.

### 3. `avgTimeInStageDays` averaged inter-event gaps, not stage occupancy

`getFunnel` closed a stage interval at the next event of *any* type.
`InterviewRoundsService.logRoundEvent` writes `INTERVIEW_ROUND_ADDED` with
`toStatus` set to the job's *current* status, so scheduling three rounds chopped
one stay in INTERVIEWING into three short intervals, each counted as its own
sample. The more rounds a job actually had, the faster that stage appeared.

### 4. Stats used the server's calendar; emails used the user's

`User.timezone` already drives the digest and reminder schedulers. `getStats`
computed its month boundary with `new Date(y, m, 1)` and `computeTrendBuckets`
bucketed with local `getFullYear/getMonth/getDate` — both the *server's* zone.
On a UTC server, a UTC+5 user's evening application landed on the previous day's
trend bar, and at a month boundary the "this month" card disagreed with the
calendar on their wall.

### 5. `resolveCompanyId` paid for uniqueness in the application layer

The find-or-create ran in a `Serializable` transaction with up to 8 jittered
retries. Its own comment explained why: the case-insensitive `findFirst` had no
matching index, so under Serializable it predicate-locked the user's whole
`(userId, name)` range and two creates for *completely unrelated* company names
aborted each other. The comment never named the fix that removes the need for
any of it.

### 6. Search could not use an index

`buildJobWhere` searches four columns with `contains` + `mode: 'insensitive'`
(`ILIKE '%term%'`), which no B-tree can serve — a sequential scan per keystroke
of the debounced search box. It also NFKC-normalized the search *term* while
stored rows kept whatever form they were written in, so a styled-Unicode value
pasted from LinkedIn could never be matched by anything typeable.

## Decision

### Re-stamp `appliedAt` when a job leaves WISHLIST

```ts
const leftWishlist = statusChanged && existing.status === JobStatus.WISHLIST;
if (leftWishlist && dto.appliedAt === undefined) {
  data = { ...data, appliedAt: new Date() };
}
```

Leaving `WISHLIST` in any direction counts — the board lets a card be dragged
straight to INTERVIEWING. An explicit `appliedAt` in the same request still
wins: a user backdating a date they know beats our inference.

### Test STALE_APPLIED on event recency

`events: { none: { createdAt: { gt: sevenDaysAgo } } }`, with the latest event
included so `since` ("stalled since") dates the stall from the last thing that
happened. `appliedAt` stays as a cheap indexed pre-filter and as the guard for a
row with no events at all. `since` still stays fixed while a job remains stale,
which is the invariant `NotificationsProcessor`'s digest dedup relies on.

### Only status-entering events bound a stage interval

`CREATED` and `STATUS_CHANGE` open and close intervals; `INTERVIEW_ROUND_ADDED`
is skipped. Each interval is a real "entered stage X → left for stage Y" span
again.

### Resolve every calendar in the user's zone

New `common/timezone.util.ts`, built on `Intl` (no new dependency — the same
approach `NotificationsScheduler` already uses). A wall-clock day is encoded as
a UTC-midnight `Date` so bucket arithmetic is plain UTC arithmetic with no DST
discontinuity, and `zonedInstantFromCivil` converts back when a true instant is
needed (a Prisma `gte` bound, a `periodStart`). An unusable stored zone falls
back to UTC rather than throwing inside a stats request.

### Let Postgres enforce case-insensitive company uniqueness

```sql
CREATE UNIQUE INDEX "companies_userId_lower_name_key"
  ON "companies" ("userId", lower("name"));
```

`resolveCompanyId` becomes a plain `findFirst` + `create` with a `P2002`
fallback: a losing racer gets a unique violation, and the winner's row is
committed by definition, so one re-fetch resolves it. No transaction, no retry
budget, no backoff — and the bulk paths (browser extension, CSV import) stop
contending on a range lock.

### Trigram indexes for search, NFKC on write

`pg_trgm` GIN indexes on `company`, `position`, `location` and `notes` — the one
index type Postgres can use for an unanchored `ILIKE` (verified against the plan:
`Bitmap Index Scan on "Job_company_trgm_idx"`). `CreateJobDto` now folds NFKC on
write, and the migration folds existing rows with Postgres's `normalize()`, so
both sides of a search comparison are in the same form.

## Alternatives Considered

### Derive the application date from the STATUS_CHANGE event instead of a column write
Rejected: every read path (list sort, range filters, CSV, three stats queries)
already filters and orders on the `appliedAt` column. Deriving it would turn
each of those into a join or a post-filter for a value that is stable once
written.

### Backfill `appliedAt` for jobs that already left WISHLIST
Rejected: the transition date isn't recoverable for rows whose events predate
this — the `STATUS_CHANGE` event has the timestamp, but a job created directly
as APPLIED has no such event, so a backfill would have to guess for exactly the
rows it can't distinguish. Going forward is correct; history stays as recorded.

### A `nameKey` column (`lower(name)`) with a Prisma-expressible `@@unique`
Rejected in favour of the functional index: it would need maintaining at every
Company write site (create, update, merge, CSV import) and adds a denormalized
column whose only job is to restate one that already exists. The functional
index has one real cost — Prisma can't express it, so `prisma migrate dev` will
propose DROPping it on the next schema change. That's documented in
`schema.prisma` next to both affected models and in `backend/CLAUDE.md`.

### Normalize `Company.name` to NFKC in the same migration as `Job`
Rejected for now: folding company names could collide two existing rows under
the new case-insensitive unique index, turning a data cleanup into a failed
migration. Job labels have no uniqueness constraint, so folding them is safe.

### Put the "this month" boundary on the JWT instead of reading `User.timezone` per request
Rejected: a token is issued for 15 minutes, so changing the timezone in the
profile wouldn't take effect until the next refresh — for a value that only
costs an indexed primary-key lookup to read.

## Consequences

- Every "applications sent" metric now dates from when the application was
  actually sent. Numbers will shift for anyone who uses the wishlist.
- `avgTimeInStageDays` for INTERVIEWING rises to its true value on any job with
  more than one round — the previous figure was biased low.
- Stats and emails finally agree on what "this month" and "today" mean.
- `resolveCompanyId` can no longer 409 on contention; the only 409 left is a
  genuine unique violation whose row vanished mid-request.
- Search is index-backed. Four GIN indexes add write cost per job mutation,
  which at this app's scale is not measurable.
- Two raw indexes now live outside Prisma's model of the schema. The next
  `prisma migrate dev` will try to drop them; the generated migration must have
  those DROP statements removed.
