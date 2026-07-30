# ADR-017: Scheduling an interview round auto-promotes APPLIED → INTERVIEWING, and every round logs a Timeline entry

## Status
Accepted (the "no new transaction boundary was introduced" line under
Consequences was superseded by [ADR-018](018-interview-round-status-sync-race-fixes.md),
which found and fixed a race condition in the non-transactional write
sequence this ADR originally accepted)

## Date
2026-07-25

## Context

`InterviewRound` (ADR-015) is a log of real-world events, decoupled from
`Job.status`. In practice this let the two drift: a user would add a
"Phone Screen" round but the job card still read `APPLIED` until they
remembered to also edit the status by hand. The Timeline (`job.events`) only
ever recorded `CREATED` and `STATUS_CHANGE` — round creation itself was
invisible there, so the log didn't reflect what actually happened at each
job.

Two related gaps needed a decision:

1. Should scheduling the first interview round change `Job.status`
   automatically?
2. Should every interview round appear on the Timeline, or only the one that
   happens to trigger a status change?

## Decision

**Auto-promotion, once, and only from `APPLIED`.** `InterviewRoundsService`
promotes `Job.status` from `APPLIED` to `INTERVIEWING` the moment a round is
created, and only if the job is still `APPLIED`. A job already in
`INTERVIEWING`, `OFFER`, `REJECTED`, `GHOSTED`, or `WISHLIST` is left alone —
the promotion never overrides a status the user set deliberately.

**Every round logs a Timeline entry, not just the first.** Added
`INTERVIEW_ROUND_ADDED` to `JobEventType`. When a round is created against a
job that's already past `APPLIED`, a plain `INTERVIEW_ROUND_ADDED` event is
written (no status change). When a round triggers the `APPLIED →
INTERVIEWING` promotion, the `STATUS_CHANGE` event's `note` field carries the
triggering round's stage name (e.g. `"Phone Screen"`), so the Timeline entry
reads as "Status changed to Interviewing → Phone Screen" instead of a bare
status flip with no explanation.

## Alternatives Considered

### Option A: No auto-promotion — require the user to change status manually
- **Pros:** Zero implicit writes; `Job.status` stays fully user-controlled.
- **Cons:** This is the status quo that caused the drift in the first place —
  users forget, and the job list shows stale `APPLIED` badges for jobs that
  are actively interviewing.
- **Rejected:** Scheduling a round is a strong, unambiguous real-world signal.
  Auto-promotion removes a manual step without removing user control, since
  it never fires once the user has moved the status anywhere else.

### Option B: Only log the round that changes status; leave later rounds off the Timeline
- **Pros:** Less code — `logRoundEvent` could early-return once `currentStatus
  !== APPLIED`.
- **Cons:** A job with five interview rounds would show exactly one Timeline
  entry ("Phone Screen") and then go silent — the Timeline stops being a log
  of what happened and becomes a log of the first thing that happened.
- **Rejected:** The whole point of `InterviewRound` (ADR-015/016) is that it's
  an honest log of events. The Timeline should mirror that, not truncate it.

### Option C: Promote on every round creation, re-triggering even if status was moved away
- **Cons:** Would fight a user who deliberately set a job to `GHOSTED` or
  `REJECTED` and then logged a late round for record-keeping — the status
  would snap back to `INTERVIEWING` unexpectedly.
- **Rejected:** The `currentStatus === APPLIED` guard in `logRoundEvent`
  (`interview-rounds.service.ts:30`) makes promotion a one-time transition,
  not a standing rule re-applied on every write.

## Consequences

- `JobEventType` gained `INTERVIEW_ROUND_ADDED` (migration +
  `prisma generate`) alongside the existing `CREATED`/`STATUS_CHANGE`.
- `InterviewRoundsService.create` now does three writes per round: the
  `InterviewRound` row, the Timeline event (via `logRoundEvent`), and the
  `nextInterviewAt` recompute — all still scoped to the single `create` call,
  no new transaction boundary was introduced.
- Frontend `Timeline` (`jobs/[id]/page.tsx`) renders `INTERVIEW_ROUND_ADDED`
  as "Interview round scheduled" and shows the promotion's `note` field
  as a "→ stage name" sub-line under the status-change entry.
- `InterviewRounds` component now also invalidates the `['job-events', id]`
  query key on mutation (previously only `['job', id]` and `['attention']`
  were invalidated) — without it the Timeline kept showing stale data after
  adding a round, since the events list has its own query key.
- Promotion is one-directional and one-shot: it only fires from `APPLIED`,
  never fires again once the status has moved anywhere else, and never
  demotes a status back down.
