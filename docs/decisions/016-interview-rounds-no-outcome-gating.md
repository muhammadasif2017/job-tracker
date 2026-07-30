# ADR-016: Interview rounds are an ungated log — no restriction after a FAILED/CANCELLED round

## Status
Accepted

## Date
2026-07-21

## Context

After ADR-015 added `InterviewRound` as a 1:many child of `Job`, the question came
up: should `POST /jobs/:jobId/interview-rounds` refuse to create a new round if
an earlier round for the same job is already `FAILED` or `CANCELLED`? A strict
reading of a hiring pipeline says once a candidate is rejected at one stage, no
further rounds should follow.

## Decision

No gating. `InterviewRoundsService.create` has no check on prior rounds'
`outcome` — a user can add a new `PENDING` round even if an earlier round for
the same job is `FAILED`.

## Alternatives Considered

### Option A: Block creating a new round if any prior round is FAILED/CANCELLED

- **Pros:** Matches the "textbook" hiring funnel — rejected means done.
- **Cons:** Doesn't match reality. Candidates get called back after a rejected
  round often enough (different team re-reaching-out, hiring manager
  reconsidering, recruiter error) that a hard block would force the user to
  delete/edit history just to log a real event that happened to them.
- **Rejected:** `InterviewRound` is a personal log of what actually happened,
  not a workflow engine enforcing what's "supposed to" happen next.

### Option B: Allow creation, but show a soft warning in the UI

- **Pros:** Flags the unusual case without blocking it.
- **Cons:** Extra UI state (banner/confirm) for a rare edge case; adds
  complexity to `InterviewRounds` component for a warning most users will
  never see, since the common case (rejected → done) doesn't need a nudge.
- **Rejected:** Not implemented for now — can be added later if it turns out
  users are confused by odd-looking timelines. No gating at all is the simpler
  starting point per the project's simplicity-first bias.

## Consequences

- `InterviewRoundsService.create`/`update` have zero cross-round validation —
  only the ownership check (`job.findFirst({ where: { id: jobId, userId } })`)
  gates writes.
- A job can end up with a timeline like `Phone Screen (FAILED)` → `Onsite
  (PENDING)`, which looks contradictory but is left to the user to interpret —
  the UI renders whatever rounds exist, in `scheduledAt` order, with no
  business-rule filtering.
- If this becomes confusing in practice, Option B (a soft warning) is the next
  step to reach for — not a hard block.
