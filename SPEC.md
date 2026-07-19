# Spec: Multi-Round Interview Tracking

## Objective

`Job.nextInterviewAt` is a single manually-typed date. Real interview pipelines have multiple stages (phone screen → technical → onsite → HR), and today each new stage overwrites the last — the user loses history of what happened at each round.

Add `InterviewRound` as a child resource of `Job`: an ordered list of interview stages, each with a date, outcome, and notes. `Job.nextInterviewAt` becomes a derived, read-only field — the earliest upcoming round still `PENDING` — computed server-side any time rounds change, so it stays a single source of truth instead of drifting out of sync.

**User:** the job seeker tracking their own pipeline.
**Success:** user can log each interview round as it's scheduled/completed; dashboard "Needs Attention" and Kanban continue to reflect the true next interview without the user re-typing a date by hand.

## Tech Stack

No new dependencies. Backend: NestJS 11 + Prisma 7 (existing). Frontend: Next.js 16 + TanStack Query v5 + RHF/Zod (existing).

## Commands

Unchanged — see root `CLAUDE.md`:
```bash
# backend
npm run start:dev
npx prisma migrate dev --name add_interview_rounds
npx prisma generate
npm run test:e2e
npx tsc --noEmit

# frontend
npm run dev
npm run lint
npm run build
```

## Project Structure

New backend module, mirrors `resumes/` (child resource of `Job`, own ownership checks via `PrismaService`, no dependency on `JobsService`):

```
backend/src/modules/interview-rounds/
├── interview-rounds.module.ts
├── interview-rounds.controller.ts   # routes nested under /jobs/:jobId/interview-rounds
├── interview-rounds.service.ts      # CRUD + nextInterviewAt recompute
└── dto/
    ├── create-interview-round.dto.ts
    ├── update-interview-round.dto.ts
    └── interview-round-response.dto.ts
```

Frontend — new component, slotted into existing job detail page:

```
frontend/components/jobs/
└── interview-rounds.tsx    # list + add/edit/delete rounds, rendered in app/(dashboard)/jobs/[id]/page.tsx
```

`frontend/types/index.ts` gains `InterviewRound`, `InterviewOutcome` types.

## Schema Change (needs migration — confirm before running)

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
  stage       String           // free text: "Phone Screen", "Onsite Loop 2", etc.
  scheduledAt DateTime
  outcome     InterviewOutcome @default(PENDING)
  notes       String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([jobId])
  @@map("interview_rounds")
}
```

`Job` gains `interviewRounds InterviewRound[]` relation. `Job.nextInterviewAt` field stays (type unchanged — `DateTime?`), but becomes **write-only-by-system**: removed from `CreateJobDto`/`UpdateJobDto`, no longer settable via `PATCH /jobs/:id`.

## Code Style

Ownership check pattern (matches `resumes.service.ts`):
```ts
async create(userId: string, jobId: string, dto: CreateInterviewRoundDto) {
  const job = await this.prisma.job.findFirst({ where: { id: jobId, userId }, select: { id: true } });
  if (!job) throw new NotFoundException('Job not found');

  const round = await this.prisma.interviewRound.create({ data: { jobId, ...dto } });
  await this.recomputeNextInterviewAt(jobId);
  return round;
}

private async recomputeNextInterviewAt(jobId: string) {
  const next = await this.prisma.interviewRound.findFirst({
    where: { jobId, outcome: InterviewOutcome.PENDING, scheduledAt: { gte: new Date() } },
    orderBy: { scheduledAt: 'asc' },
    select: { scheduledAt: true },
  });
  await this.prisma.job.update({
    where: { id: jobId },
    data: { nextInterviewAt: next?.scheduledAt ?? null },
  });
}
```
Call `recomputeNextInterviewAt` after create/update/delete of any round for that job.

Routes follow `resumes.controller.ts` nesting (`@Controller('jobs')`, methods path `:jobId/interview-rounds...`), same `@CurrentUser()` + `@ApiTags('jobs')` conventions.

## Testing Strategy

- `interview-rounds.service.spec.ts` — unit tests for CRUD + `recomputeNextInterviewAt` (earliest-pending logic, null when none pending, ignores `PASSED`/`FAILED`/`CANCELLED`/past-dated rounds).
- Extend `backend/test/app.e2e-spec.ts`: create round → assert `Job.nextInterviewAt` updates; mark outcome `FAILED` → assert `nextInterviewAt` recomputes to next pending round or `null`.
- Frontend: no new Playwright spec required unless requested — cover via existing `jobs.spec.ts` pattern if the team wants e2e coverage (ask first, per existing test scope).

## Boundaries

- **Always:** run `prisma generate` after migration; keep ownership check (`job.userId === user.id`) on every round mutation — never trust `jobId` from the body alone.
- **Ask first:** running `prisma migrate dev` against the shared dev DB (per root `CLAUDE.md`) — this spec requires one migration (`add_interview_rounds`).
- **Never:** allow `nextInterviewAt` to be set directly via `CreateJobDto`/`UpdateJobDto` again — it must stay derived, or the sync guarantee breaks silently.

## Success Criteria

1. `POST /jobs/:jobId/interview-rounds` creates a round scoped to the caller's job (404 if not owned).
2. `Job.nextInterviewAt` always equals the earliest **future** `PENDING` round's `scheduledAt` (`scheduledAt: { gte: now }` filter — confirmed).
3. Existing Kanban/attention/CSV export behavior unchanged — they keep reading `nextInterviewAt`, now system-computed.
4. `JobForm` no longer shows a manual "next interview" date input.
5. Job detail page shows an editable list of rounds (add/edit outcome/delete), ordered by `scheduledAt`. Rounds can only be added from the job detail page (not inline during job creation).
6. `CANCELLED` outcome renders as a plain dropdown value — no special row styling.
