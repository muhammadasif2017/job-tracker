# Spec: Contact / Recruiter Tracking

## Objective

Users can track people associated with a job application — recruiters, hiring managers, referrals, interviewers — as a child record of the job. Mirrors the existing `InterviewRound` module's structure end to end.

**User stories:**
- As a user, I can add a contact (name, role, email, phone, LinkedIn, notes) to a job
- As a user, I can see all contacts for a job on the job detail page
- As a user, I can edit or remove a contact
- As a user, I cannot see or modify contacts on a job I don't own

**Out of scope for v1:** no reminders/notifications tied to contacts, no cross-job contact reuse (e.g. same recruiter appearing on multiple jobs is just duplicated rows, not deduped), no import from LinkedIn/email.

## Tech Stack

No new dependencies. Same stack as `interview-rounds`: NestJS + Prisma (backend), Next.js + React Hook Form + Zod + TanStack Query (frontend).

## Commands

```bash
# Backend
npx prisma migrate dev --name add-contacts     # after schema change — ask before running
npx prisma generate                            # regenerate client
```

## Project Structure

```
backend/
  src/
    modules/
      contacts/
        contacts.module.ts
        contacts.controller.ts
        contacts.controller.spec.ts
        contacts.service.ts
        contacts.service.spec.ts
        dto/
          create-contact.dto.ts
          update-contact.dto.ts
          contact-response.dto.ts

frontend/
  components/
    jobs/
      contacts.tsx                  # list/add/edit/delete, same shape as interview-rounds.tsx
```

## Data Model

```prisma
model Contact {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  name        String
  role        String?
  email       String?
  phone       String?
  linkedinUrl String?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([jobId])
  @@map("contacts")
}
```

`Job` gets:
```prisma
contacts  Contact[]
```

Ownership is derived through `job.userId`, same pattern as `interviewRounds` — every service method calls `ensureJobOwned(userId, jobId)` first (`findFirst({ id: jobId, userId })`, 404 if missing).

`JobsService.findOne` include gains `contacts: { orderBy: { createdAt: 'asc' } }` alongside `companyProfile`, `resume`, `interviewRounds` — embedded in the existing `GET /jobs/:id` response, no separate fetch needed on the frontend.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/jobs/:jobId/contacts` | Add a contact to a job |
| `GET` | `/jobs/:jobId/contacts` | List contacts for a job |
| `PATCH` | `/jobs/:jobId/contacts/:contactId` | Update a contact |
| `DELETE` | `/jobs/:jobId/contacts/:contactId` | Remove a contact |

**Field validation** (`class-validator`, matching `CreateInterviewRoundDto` conventions):
- `name`: required, non-empty, max 200 chars
- `role`: optional, max 100 chars (free text — "Recruiter", "Hiring Manager", "Referral", "Interviewer", etc., not an enum)
- `email`: optional, must be a valid email if present, max 255 chars
- `phone`: optional, max 30 chars, no format validation (international formats vary too widely)
- `linkedinUrl`: optional, must be a valid URL if present, max 500 chars
- `notes`: optional, max 5000 chars (same limit as `InterviewRound.notes`)

**Soft cap:** `MAX_CONTACTS_PER_JOB = 20` — same rationale as `MAX_ROUNDS_PER_JOB` in interview-rounds (guards against unbounded growth from a scripted client, not a security boundary).

No `JobEvent` logging, no status-promotion side effects, no transaction needed for create/update/delete (contacts don't drive `Job.status` or `nextInterviewAt` the way interview rounds do — plain CRUD).

## Frontend Behavior

**`Contacts` component** (props: `jobId: string`, `contacts: Contact[]` — embedded from `job.contacts`, same pattern as `InterviewRounds`):
- Empty state: "No contacts yet" + add button
- List: name, role badge, email/phone/LinkedIn as clickable links (`mailto:`, `tel:`, external link), notes truncated with expand
- Add/edit: inline form (React Hook Form + Zod), same modal/inline pattern as `InterviewRounds`
- Delete: inline confirm-toggle (`Remove?` / Yes / No), same as `ResumeUpload`/`InterviewRounds` — no modal

**Query keys:** no new query key — contacts ride on `['job', id]` like `interviewRounds`. Mutations invalidate `['job', jobId]` only (contacts don't affect `['jobs']`, `['stats']`, `['analytics', 'funnel']`, or `['attention']` — unlike interview rounds, they never change job status).

**Types:** add `Contact` interface and `contacts?: Contact[]` on `Job` in `types/index.ts`.

## Boundaries

- **Always:** ownership check (`ensureJobOwned`) before any contact operation; validate email/URL format server-side; scope every query by `userId` through the job relation (404, not 403, for another user's job — no existence leak, matching existing convention).
- **Ask first:** running `prisma migrate dev` against the shared dev DB (per project `CLAUDE.md`); any change to the soft cap or field limits after initial implementation.
- **Never:** add notification/reminder/cron behavior for contacts in v1; let a contact mutation touch `Job.status` or `nextInterviewAt`; expose one user's contacts to another.

## Success Criteria

- [ ] User can add a contact to a job with name (required) + optional role/email/phone/LinkedIn/notes
- [ ] Job detail page lists all contacts for that job
- [ ] User can edit a contact
- [ ] User can delete a contact (with confirm step)
- [ ] Invalid email/URL rejected with a clear error, server-side
- [ ] A job can have at most 20 contacts (soft cap, clear error past it)
- [ ] Deleting a job cascades to delete its contacts
- [ ] Users cannot view or modify contacts on a job they don't own (404)
- [ ] Backend: controller + service spec tests pass (`npm run test:e2e` equivalent unit coverage matching `interview-rounds.*.spec.ts` style)
- [ ] Frontend: `npm run build` succeeds, `npm test` passes
