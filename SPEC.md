# Spec: Email Reminders + Digest

## Objective

Close the "silent app" gap: job-tracker only helps when the user opens it. Missed interviews and forgotten follow-ups happen between visits. This feature pushes the app's existing attention signals out via email.

**User stories:**

- As a job seeker, I get an email ~24h before a scheduled interview so I never miss one.
- As a job seeker, I can opt into a daily or weekly digest listing what needs action (upcoming interviews, stale INTERVIEWING jobs, stale APPLIED jobs) so I stay on top of my search without opening the app.
- As a user, I control both email types from my profile page.

**Success looks like:** a user with a pending interview round scheduled tomorrow receives exactly one reminder email; a user with `digestFrequency=DAILY` and non-empty attention items receives one digest per day; a user with everything disabled receives nothing.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Email provider | Resend (free tier). No API key → EmailService logs and no-ops, app boots fine (mirrors OAuth `'placeholder'` pattern). |
| Digest default | `OFF` — opt-in. |
| Interview reminders default | `ON` — opt-out. |
| Delivery | BullMQ queue (`notifications`), mirrors `EnrichmentModule` pattern. Cron enqueues, processor sends. |
| Reminder dedup | `reminderSentAt DateTime?` on `InterviewRound`, stamped in same transaction as enqueue. Crash → at most one missed email, never a double send. |
| Prefs storage | Two new columns on `User` (no new model): `interviewRemindersEnabled Boolean @default(true)`, `digestFrequency DigestFrequency @default(OFF)`. |
| Timezones | Out of scope v1. Digest fires at fixed UTC hour (08:00 UTC daily; Mondays 08:00 UTC weekly). |
| Unsubscribe | Email footer links to `${FRONTEND_URL}/profile`. No signed tokens in v1. |

## Tech Stack

Existing: NestJS 11, Prisma 7 (`@prisma/adapter-pg`), BullMQ + Redis, `@nestjs/schedule` (already in `AppModule`), nestjs-pino. Frontend: Next.js 16, TanStack Query v5, RHF + Zod.

New dependency: `resend` (backend only — small SDK, justified per repo dependency rule).

New env vars (backend):

| Variable | Required | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | No | Unset → email sends are logged, not sent |
| `EMAIL_FROM` | No | Default `onboarding@resend.dev` for testing |

## Commands

```bash
# backend
npm run start:dev                       # watch mode :3001
npx tsc --noEmit                        # type check
npm run test:e2e                        # e2e (live local PostgreSQL :5432)
npx prisma migrate dev --name add-notification-prefs   # ASK FIRST (shared dev DB)
npx prisma generate                     # ALWAYS after migrate

# frontend
npm run dev
npm run build                           # required gate before "done" (repo rule)
npm run lint
```

## Schema Changes

```prisma
enum DigestFrequency {
  OFF
  DAILY
  WEEKLY
}

model User {
  // ... existing fields
  interviewRemindersEnabled Boolean         @default(true)
  digestFrequency           DigestFrequency @default(OFF)
}

model InterviewRound {
  // ... existing fields
  reminderSentAt DateTime?
}
```

Additive-only: nullable + defaults, no backfill needed, safe for shared dev DB and e2e suite.

## Project Structure

```
backend/src/modules/notifications/
  notifications.module.ts        → registers BullMQ queue, providers
  notifications.scheduler.ts     → @Cron methods (reminder scan, digest fan-out)
  notifications.processor.ts     → BullMQ worker: renders template, calls EmailService
  email.service.ts               → thin Resend wrapper; logs + no-ops without API key
  templates.ts                   → plain functions returning HTML strings (no template lib)
backend/src/modules/jobs/
  attention.helper.ts            → attention query extracted from JobsService.getAttention
                                   (shared with digest; avoids dragging storage/enrichment deps)
backend/src/modules/users/
  dto/update-notification-prefs.dto.ts
frontend/components/profile/
  notification-settings.tsx      → toggle + frequency select card on profile page
```

`NotificationsModule` added to `AppModule.imports`.

## Behavior

**Interview reminder (hourly cron):**

1. Query: `InterviewRound` where `outcome=PENDING`, `scheduledAt` between now and now+24h, `reminderSentAt=null`, and job's user has `interviewRemindersEnabled=true`.
2. Per round, in one transaction: stamp `reminderSentAt`, then enqueue `interview-reminder` job with `{ roundId }`.
3. Processor re-reads round + job + user, renders template (company, position, round type, scheduled time), sends.

**Digest (daily 08:00 UTC / weekly Mon 08:00 UTC crons):**

1. Query users with matching `digestFrequency`.
2. Per user: compute attention items via shared `attention.helper`. Empty → skip (no email).
3. Enqueue `digest` job with `{ userId }`; processor recomputes items at send time, renders, sends.

**Prefs API:** `PATCH /users/me/notifications` with DTO `{ interviewRemindersEnabled?, digestFrequency? }`; prefs included in existing profile GET response. `@CurrentUser()` for identity, never body user IDs.

**Frontend:** "Email notifications" card on `(dashboard)/profile` — switch for reminders, select for digest (Off/Daily/Weekly). RHF + Zod inline schema per repo pattern; mutation invalidates the profile query key.

## Code Style

Match existing repo conventions exactly:

```ts
// .js import extensions (ESM-style paths, compiles to CJS)
import { PrismaService } from '../../prisma/prisma.service.js';

// Nest exceptions only — never plain Error (GlobalExceptionFilter passes them through)
throw new BadRequestException('Invalid digest frequency');

// Injected pino logger for explicit lines
this.logger.log('Reminder enqueued', { roundId });
```

Queue/processor shape copies `enrichment.processor.ts` (`ENRICHMENT_QUEUE` const export, `@Processor` class). DTOs one file per shape under `dto/`. Commit style: `Add X` / `Fix Y`, single line, no attribution.

## Testing Strategy

- **e2e (`backend/test/app.e2e-spec.ts`):** prefs endpoint — PATCH prefs, GET profile, assert round-trip; validation failure case (bad enum → 400). Runs against live dev DB with the timestamped-user pattern.
- **Scheduler logic:** manual verification in dev — trigger scheduler methods directly, confirm log-only sends and `reminderSentAt` stamping; confirm second run skips already-stamped rounds (dedup proof).
- **No mocked-email unit suite in v1** — EmailService's no-key log path doubles as the test seam.
- **Frontend:** `npm run build` must pass (repo rule — catches prop-type mismatches lint misses). Existing Playwright e2e untouched.

## Boundaries

- **Always:** run `prisma generate` after migrate; `npx tsc --noEmit` + e2e before backend commits; `npm run build` before frontend done; stamp `reminderSentAt` before/with enqueue (never after send).
- **Ask first:** running the migration against shared dev DB; any change to `schema.prisma` beyond the fields above; adding any dependency beyond `resend`.
- **Never:** commit `RESEND_API_KEY` or any `.env`; send email for users with prefs disabled; put tokens/PII beyond name + job titles in email bodies; modify `main.ts` global pipes (would desync e2e setup).

## Success Criteria

1. Round scheduled <24h out, prefs ON → exactly one reminder enqueued; rerunning cron enqueues zero (dedup).
2. `digestFrequency=DAILY` + non-empty attention → one digest/day. Empty attention → no email. `OFF` → never.
3. `interviewRemindersEnabled=false` → no reminder for that user's rounds.
4. No `RESEND_API_KEY` → app boots, sends logged, nothing thrown.
5. Prefs round-trip via API and profile UI; e2e green; `tsc --noEmit` and frontend `npm run build` clean.

## Tasks

Dependency-ordered. Each ≤5 files, one focused session, one atomic commit (`Add X` style).

- [ ] **T1: Schema + migration** — `DigestFrequency` enum, `User.interviewRemindersEnabled`/`digestFrequency`, `InterviewRound.reminderSentAt`. **Ask before `migrate dev`** (shared dev DB), then `prisma generate`.
  - Acceptance: migration applied, TS client sees new types.
  - Verify: `npx tsc --noEmit`; `npm run test:e2e` still green.
  - Files: `schema.prisma`, generated migration.
- [ ] **T2: Attention helper extraction** — move `getAttention` queries into `jobs/attention.helper.ts(prisma, userId)`; `JobsService` delegates. Behavior unchanged. *(No deps — parallel with T1.)*
  - Acceptance: `GET /jobs/attention` response identical.
  - Verify: `npx tsc --noEmit`; e2e green.
  - Files: `attention.helper.ts` (new), `jobs.service.ts`.
- [ ] **T3: NotificationsModule core** *(needs T1)* — module + `NOTIFICATIONS_QUEUE`, `EmailService` (Resend; no key → log + no-op), `templates.ts`, `NotificationsProcessor` (`interview-reminder`/`digest` jobs, re-reads data + prefs at send time). Wire into `AppModule`. Add `resend` dep.
  - Acceptance: boots without `RESEND_API_KEY`; manual enqueue logs rendered send.
  - Verify: `npx tsc --noEmit`; `npm run start:dev` boots clean.
  - Files: 4 new module files, `app.module.ts`, `package.json`.
- [ ] **T4: Scheduler crons** *(needs T1–T3)* — hourly reminder scan (stamp `reminderSentAt` + enqueue in one transaction), daily/weekly digest fan-out via attention helper, skip empty.
  - Acceptance: single send per round (rerun = zero); disabled prefs → nothing; empty attention → no digest.
  - Verify: manual dev trigger, log-only sends, DB stamp check.
  - Files: `notifications.scheduler.ts` (new), `notifications.module.ts`.
- [ ] **T5: Prefs API + e2e** *(needs T1)* — `PATCH /users/me/notifications` + DTO; prefs in profile GET. e2e round-trip + invalid-enum 400.
  - Acceptance: prefs persist, validation rejects garbage.
  - Verify: `npm run test:e2e` green.
  - Files: `users.controller.ts`, `users.service.ts`, DTO (new), `app.e2e-spec.ts`.
- [ ] **T6: Frontend settings card** *(needs T5)* — switch + frequency select on profile page, RHF+Zod, mutation invalidates profile query.
  - Acceptance: prefs editable, persist across reload.
  - Verify: `npm run build`; manual UI check.
  - Files: `notification-settings.tsx` (new), profile `page.tsx`, `types/index.ts`, api hook.
- [ ] **T7: Docs + env** *(needs T4, T6)* — CLAUDE.md env table + module list, `.env.example`.
  - Acceptance: docs match implementation.
  - Verify: diff review.

Parallel lanes after T1: backend lane T3→T4, API lane T5→T6, T2 anytime.

## Open Questions

- Reminder lead time fixed at 24h — configurable later if requested.
- Weekly digest day (Monday) — arbitrary; confirm or change cheaply.
- Resend sender domain: `onboarding@resend.dev` works for testing but only sends to the account owner's email; production needs a verified domain.
