# ADR-015: InterviewRound as a separate 1:many model; nextInterviewAt becomes a derived field

## Status
Accepted

## Date
2026-07-20

## Context

`Job.nextInterviewAt` was a single manually-typed date. Real interview pipelines
have multiple stages (phone screen → technical → onsite → HR), and each new stage
overwrote the last — the user lost history of what happened at earlier rounds, and
had to remember to re-type the date by hand every time a stage was scheduled.

The question is twofold: where does per-round data live in the schema, and who
owns writing `nextInterviewAt` once multiple rounds exist.

## Decision

Add an `InterviewRound` model with a 1:many relation to `Job` (`onDelete: Cascade`),
and make `nextInterviewAt` a **derived, system-computed field** — recomputed after
every create/update/delete of a round for that job, never accepted from the client.

```prisma
enum InterviewOutcome {
  PENDING
  PASSED
  FAILED
  CANCELLED
}

model InterviewRound {
  id          String           @id @default(cuid())
  jobId       String
  job         Job              @relation(fields: [jobId], references: [id], onDelete: Cascade)
  stage       String
  scheduledAt DateTime
  outcome     InterviewOutcome @default(PENDING)
  notes       String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([jobId])
}
```

Recompute logic (`InterviewRoundsService.recomputeNextInterviewAt`): set
`Job.nextInterviewAt` to the earliest `PENDING` round with `scheduledAt >= now`,
or `null` if none. Non-`PENDING` outcomes (`PASSED`/`FAILED`/`CANCELLED`) and
past-dated rounds are excluded regardless of order.

`CreateJobDto`/`UpdateJobDto` no longer accept `nextInterviewAt` — the global
`ValidationPipe` has `forbidNonWhitelisted: true`, so a client sending it now gets
a 400 rather than a silently ignored field.

## Alternatives Considered

### Option A: Add InterviewRound, but keep nextInterviewAt manually editable too

- **Pros:** Zero risk to existing Kanban/attention/CSV export code, which all read
  `nextInterviewAt` directly — smallest possible diff.
- **Cons:** Two sources of truth. A user could log a round in the new list and
  forget to update `nextInterviewAt` by hand, so the dashboard "Needs Attention"
  card would silently drift from what the round list actually says.
- **Rejected:** The whole point of the feature is to stop the user from manually
  tracking this. Leaving a manual override defeats it.

### Option B: Embed rounds as a JSON array on Job

```prisma
model Job {
  // ...
  interviewRounds Json?  // [{ stage, scheduledAt, outcome, notes }, ...]
}
```

- **Pros:** No JOIN; single table.
- **Cons:** Same reasoning as ADR-003 (CompanyProfile) — the `InterviewOutcome`
  enum can't be enforced inside JSON, no per-round `@@index`, no cascade-delete
  semantics for individual rounds, no way to query "jobs with an upcoming pending
  round" at the DB level.
- **Rejected:** Type safety and per-row semantics matter more than avoiding one JOIN.

### Option C: Keep a single nextInterviewAt, no round history at all

- **Pros:** No schema change.
- **Cons:** Doesn't solve the original problem — history of earlier rounds is still
  lost on every overwrite.
- **Rejected:** Doesn't meet the requirement.

## Consequences

- `JobsService.findOne` includes `interviewRounds: { orderBy: { scheduledAt: 'asc' } }`
  alongside `companyProfile`/`resume` — the job detail page's existing `['job', id]`
  query already carries round data, so the frontend needs no separate query key;
  round CRUD mutations just invalidate `['job', id]` (and `['attention']`, since
  `nextInterviewAt` feeds the "Needs Attention" dashboard card).
- `recomputeNextInterviewAt` is two sequential writes (round write, then job write),
  not wrapped in a transaction. A crash between them leaves a stale
  `nextInterviewAt` until the next round mutation — acceptable for this feature;
  wrapping in `prisma.$transaction` was considered scope creep beyond what was asked.
- Removing `nextInterviewAt` from `CreateJobDto`/`UpdateJobDto` is a breaking API
  change gated by `forbidNonWhitelisted: true` — the backend DTO removal and the
  frontend `JobForm` field removal had to ship in the same change, not
  independently, or the old frontend would 400 on every job create/edit.
- Ownership checks (`job.findFirst({ where: { id: jobId, userId } })`) happen in
  `InterviewRoundsService` directly via `PrismaService`, mirroring the `resumes/`
  module pattern — no dependency on `JobsService`.
