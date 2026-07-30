# ADR-018: Race-condition fixes for interview-round status sync (transactional writes, CAS promotion, CAS on manual status update)

## Status
Accepted

## Date
2026-07-31

## Context

A code review of the status-update / Timeline / interview-rounds feature area
(ADR-015/016/017) found three related defects in `InterviewRoundsService` and
`JobsService`, none caught by the existing unit suite because its mocks
matched the buggy behavior rather than the intended one:

### 1. Non-transactional 3-write sequence in `InterviewRoundsService.create`
`create()` did the `InterviewRound` insert, `logRoundEvent`, and
`recomputeNextInterviewAt` as three separate, unrelated Prisma calls (ADR-017
"Consequences" explicitly called this acceptable). A failure partway left an
orphaned round: the row committed but its Timeline event and
`nextInterviewAt` recompute never ran, and the client still saw a 500 for an
operation that had partially succeeded.

### 2. TOCTOU in the APPLIED → INTERVIEWING promotion
`logRoundEvent` read `job.status` once (via `ensureJobOwned`, before the
transaction existed at all) and then wrote unconditionally later. Two
concurrent `POST /jobs/:jobId/interview-rounds` requests against the same
`APPLIED` job could both observe `status === APPLIED` and both execute the
promotion, producing two `STATUS_CHANGE (APPLIED → INTERVIEWING)` Timeline
entries for a single real transition — violating ADR-017's "auto-promotion,
once" guarantee under concurrency.

### 3. TOCTOU in `JobsService.update`'s manual status change
`update()` read `existing.status`, then wrote the `STATUS_CHANGE` event's
`fromStatus` from that stale read. If a concurrent interview-round promotion
(defect 2) changed the status in between, the manually-triggered event
recorded an incorrect `fromStatus`, corrupting the audit trail (e.g. a true
`APPLIED → INTERVIEWING → OFFER` history collapsing to a Timeline that reads
`APPLIED → OFFER`).

## Decision

### 1. Wrap the round-create sequence in one transaction
`InterviewRoundsService.create`, `update`, and `remove` now run their writes
inside `prisma.$transaction(async (tx) => { ... })`. A failure at any point
rolls back everything — a round can no longer exist without its event, or
survive with a stale `nextInterviewAt`.

### 2. CAS the promotion instead of read-then-write
```ts
const { count } = await tx.job.updateMany({
  where: { id: jobId, status: JobStatus.APPLIED },
  data: { status: JobStatus.INTERVIEWING },
});
if (count > 0) {
  // this request won the promotion — write STATUS_CHANGE
} else {
  // lost the race (or wasn't APPLIED to begin with) — write
  // INTERVIEW_ROUND_ADDED against the job's actual current status
}
```
Only one concurrent `updateMany` can match the row; Postgres's row lock
serializes the two requests, not application code. This is the same pattern
ADR-014 used for the refresh-token rotation race. Because `updateMany` can't
carry a nested `events: { create: ... } }`, the event write is now a second
statement inside the same transaction — a deliberate, documented exception to
the "same Prisma operation" rule below.

### 3. CAS the manual status transition in `JobsService.update`
```ts
const { count } = await tx.job.updateMany({
  where: { id: jobId, status: existing.status },
  data: { status: dto.status },
});
if (count === 0) {
  throw new ConflictException('Job status changed concurrently — refresh and try again');
}
```
On `count === 0` the request 409s instead of writing a `fromStatus` that's no
longer true. The frontend's `patchStatus` mutation now has an `onError` that
toasts the message and invalidates `['job', id]`, so the status `<select>`
snaps to the real current value instead of silently reverting with no
explanation (previously `patchStatus` had no `onError` at all).

## Alternatives Considered

### Serializable isolation level instead of CAS
- Would also close both TOCTOU windows, but requires retry-on-conflict
  handling at every call site (Postgres aborts one transaction on a
  serialization failure) and applies stricter locking to unrelated
  concurrent reads on the same table. Rejected: the conditional `updateMany`
  gets the same correctness guarantee for the two specific fields that
  actually race (`Job.status`), with no new failure mode to handle beyond
  the `count === 0` branch already needed for the response.

### `SELECT ... FOR UPDATE` via raw SQL
- Would let the promotion and the manual update stay as a single
  read-then-write while still serializing on the row. Rejected: adds a raw
  query outside Prisma's typed client for a problem the conditional
  `updateMany` already solves without leaving the query builder.

## Known Remaining Gap — Closed

Originally shipped with a documented gap: `recomputeNextInterviewAt` read
(`findFirst`) and wrote (`job.update`) without a row lock on the
non-promoting path, so two concurrent round mutations on the same job could
interleave and leave a stale `nextInterviewAt`. This is now closed —
`recomputeNextInterviewAt` is a single raw `UPDATE` with the `MIN(...)`
subquery inline:
```sql
UPDATE "Job" SET "nextInterviewAt" = (
  SELECT MIN("scheduledAt") FROM "interview_rounds"
  WHERE "jobId" = $1 AND "outcome" = 'PENDING' AND "scheduledAt" >= now()
) WHERE "id" = $1;
```
A single statement forces Postgres to serialize the two writers on the job
row and re-evaluate the subquery fresh for each one — no read-then-write gap
for a concurrent mutation to land in. Verified against real Postgres via the
existing e2e cases (`app.e2e-spec.ts`, "creates a round and recomputes
nextInterviewAt" / "updates outcome and recomputes nextInterviewAt to null
when none remain pending").

## Consequences
- `InterviewRoundsService.create/update/remove` all take a `Prisma.TransactionClient`
  through `logRoundEvent`/`recomputeNextInterviewAt`, which are now private
  helpers parameterized on `tx` rather than calling `this.prisma` directly.
- `JobsService.update` splits into a plain-update path (status unchanged) and
  a `$transaction`-wrapped CAS path (status changing); `ConflictException` is
  a new possible response from `PATCH /jobs/:id`.
- The backend CLAUDE.md "Jobs: Event Logging" section's "never in a separate
  call" rule now has a documented, narrow exception — see the section itself
  for the amendment.
- Unit test mocks (`interview-rounds.service.spec.ts`, `jobs.service.spec.ts`)
  now stub `$transaction` as `jest.fn((fn) => fn(mockPrisma))` — a passthrough
  that verifies the branching logic but cannot verify real transaction
  atomicity, exception-to-HTTP-status mapping, or the actual `WHERE` clause
  against Postgres. `backend/test/app.e2e-spec.ts` (or a new e2e case) against
  a live database is the only check that closes that gap.
