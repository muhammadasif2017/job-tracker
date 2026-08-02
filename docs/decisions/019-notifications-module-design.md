# ADR-019: Notifications module — separate BullMQ queue, cron-driven reminders/digests, dedup via stamped timestamps

## Status
Accepted

## Date
2026-08-01

## Context

The app needed two email-triggered behaviors: an interview reminder ~24h
before a scheduled round, and a daily/weekly digest of jobs needing
attention. Both are cron-driven, both send through the same Resend-backed
`EmailService`, and both had to avoid the two failure modes that matter most
for unsolicited email: **never send the same email twice**, and **never
silently drop one** (a stale reminder helps no one, but a duplicate digest
every day forever is worse).

`GET /jobs/attention` already existed with heuristics for "needs attention"
(stale APPLIED, stale INTERVIEWING, upcoming interview). The digest had to
use the exact same definition — a second, drifted definition of "needs
attention" between the API and the emails would be confusing and hard to
keep in sync.

## Decision

### Separate BullMQ queue, not reuse of the enrichment queue
`NotificationsModule` registers its own `notifications` queue (via
`BullModule.registerQueue`) rather than adding job types to
`EnrichmentModule`'s existing queue. Email sends and LLM-based company
enrichment have unrelated retry/backoff needs and failure semantics; a
separate queue keeps their `JOB_OPTIONS` (attempts, backoff) independently
tunable and keeps one domain's backlog from head-of-line-blocking the other.

### Digest reuses `jobs/attention.helper.ts` directly
`NotificationsScheduler.fanOutDigest` and `NotificationsProcessor.processDigest`
both call `getAttentionItems(prisma, userId)` — the same helper
`JobsService` uses for `GET /jobs/attention`. There is exactly one
"needs attention" heuristic in the codebase; the digest can't drift from
what the UI shows.

### Interview reminders: stamp-before-enqueue CAS, not enqueue-then-stamp
```ts
const { count } = await this.prisma.interviewRound.updateMany({
  where: { id, reminderSentAt: null },
  data: { reminderSentAt: now },
});
if (count === 0) continue;
await this.queue.add('interview-reminder', data, JOB_OPTIONS);
```
The DB write happens *before* the queue add, and it's a conditional
`updateMany` (same compare-and-swap pattern as ADR-014's refresh-token
rotation and ADR-018's status-change CAS) rather than a plain
read-then-write. Two consequences, both deliberate:
- If the process crashes between the stamp and the enqueue, the reminder is
  **silently skipped**, never double-sent. A missed reminder is recoverable
  (the user still sees the interview in the app); a duplicate reminder email
  is not something you can take back.
- The `count === 0` branch means a concurrent scan (e.g. two instances, or
  an overlapping run) can't both claim the same round — Postgres's row lock
  serializes it, not application code.

### `reminderSentAt` is un-stuck on every path that should retry
Three separate places reset `reminderSentAt` back to `null` instead of
leaving it stamped:
1. `NotificationsProcessor.onFailed` — once BullMQ exhausts all attempts
   (e.g. a Resend outage), the round is unstamped so the next hourly scan
   picks it up again. Without this, a transient outage would silently and
   permanently lose that reminder.
2. `processInterviewReminder` — if the user has since disabled
   `interviewRemindersEnabled`, the round is unstamped rather than treated
   as "handled," so re-enabling the preference before the interview makes
   the scan pick it up again.
3. The `outcome !== PENDING` check at the top of `processInterviewReminder`
   handles cancellation/rescheduling implicitly: a cancelled round's queued
   job becomes a no-op rather than sending a stale reminder.

### Digest cron firing is deduped via a deterministic BullMQ `jobId`
```ts
const dateKey = new Date().toISOString().slice(0, 10);
await this.queue.add('digest', data, {
  ...JOB_OPTIONS,
  jobId: `digest-${frequency}-${userId}-${dateKey}`,
});
```
BullMQ treats a second `add()` with an already-present `jobId` as a no-op.
Keying on `frequency + userId + UTC date` means a restart or a second
instance re-running the same cron window for the same user can't produce a
second queued job — no extra locking table needed, BullMQ's own dedup
covers it.

### All crons pinned to UTC
```ts
@Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
@Cron('0 8 * * *', { timeZone: 'UTC' })
@Cron('0 8 * * 1', { timeZone: 'UTC' })
```
Without an explicit `timeZone`, `@nestjs/schedule` runs on the host's local
time zone, which drifts from the UTC-labelled times already baked into
`templates.ts` and from the UTC calendar date used to build the digest
dedup `jobId` above — and is the only way to be safe from an hour being
skipped or repeated across a host-local DST transition. (This was shipped
without the pin first, then fixed — see commit `79dc316`.)

### Digest content dedup: per-item timestamp, stamped only after send, stamp failure is non-fatal
`STALE_APPLIED` and `STALE_INTERVIEWING` attention reasons don't self-resolve
— without suppression they'd repeat in every digest forever. Each is deduped
via a per-job timestamp field (`staleAppliedDigestedAt` /
`staleInterviewingDigestedAt`) compared against the attention item's
`since`: already-reported and unchanged → suppressed; `since` moved forward
(the underlying staleness reset and recurred) → reported again.
`UPCOMING_INTERVIEW` is deliberately not deduped — its 48h window resolves
on its own in a couple of days.

The stamp write happens **after** the email send succeeds, and a failure to
write the stamp is caught and logged, not thrown:
```ts
.catch((error) => this.logger.warn('digest_dedup_stamp_failed', { jobId: item.job.id, error }));
```
Throwing here would fail the BullMQ job and trigger a retry — which would
re-send the email that already went out. The accepted worst case of a stamp
failure is one item repeating in tomorrow's digest (the same behavior as
before this dedup feature existed); a duplicate email is a strictly worse
outcome than that, so the code chooses to risk the former over the latter.

### `EmailService` wraps the Resend SDK's non-throwing error contract
```ts
const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });
if (error) throw new Error(`Failed to send email: ${error.message}`);
```
The Resend SDK resolves with `{ data: null, error }` on an API-level failure
instead of throwing. Without the explicit `if (error) throw`, a failed send
would look like success to both the BullMQ job (no retry triggered) and the
digest dedup-stamp logic (which only skips stamping on send failure) —
turning every Resend outage into silently-lost email.

### Injection defenses: HTML-escaping and header sanitization are separate concerns
User-controlled fields (company, position, interview stage) are
HTML-escaped for the email body (`escapeHtml`), but the same fields also
appear in the email **subject**, which becomes a raw header line — HTML
escaping doesn't protect against that. A second function,
`sanitizeHeaderText`, strips `\r`/`\n` from anything interpolated into a
subject line to prevent header injection. The two are applied independently
because escaping one doesn't cover the other's threat model.

## Alternatives Considered

### Reuse `EnrichmentModule`'s BullMQ queue for email jobs
Would avoid registering a second queue. Rejected: enrichment jobs (LLM
calls, external search) and email jobs have unrelated retry/backoff needs
and failure costs; sharing a queue would couple their tuning and let one
domain's backlog delay the other's workers.

### Enqueue-then-stamp for interview reminders
Simpler ordering (do the "real" work, then record it), but flips the
failure mode: a crash between enqueue and stamp would leave the round
unstamped, so the next scan re-enqueues it — risking a duplicate send
instead of a missed one. Rejected for the reason stated above: a missed
reminder is recoverable, a duplicate is not.

### A dedicated dedup/lock table for cron-fire idempotency
Would work but adds new infrastructure and a cleanup story. Rejected:
BullMQ's built-in same-`jobId`-is-a-no-op behavior already provides exactly
this guarantee for free.

### Throwing on digest dedup-stamp failure (to guarantee the stamp is never missed)
Would make the "at most once per occurrence" digest guarantee airtight, but
the retry it triggers re-sends an email that was already delivered
successfully. Rejected: a duplicate send is a real, user-visible regression;
a repeated digest line for one more day is not.

### Rely on the host's local time zone for crons
This is what shipped first, and it drifted from the UTC-labelled template
times and caused DST-boundary edge cases. Rejected once identified — see
commit `79dc316`, which pinned every `@Cron` decorator to `timeZone: 'UTC'`.

## Consequences
- `NotificationsScheduler` and `NotificationsProcessor` both depend on
  `jobs/attention.helper.ts`; a change to attention heuristics automatically
  changes digest content — this is intentional, not a coupling to avoid.
- `InterviewRound.reminderSentAt` is not a simple "sent" flag — it's a CAS
  guard that three different code paths (permanent failure, disabled
  preference, and the initial stamp-before-enqueue) can set or clear. Any
  future change to reminder logic needs to preserve all three reset paths,
  not just the happy path.
- `Job.staleAppliedDigestedAt` / `staleInterviewingDigestedAt` are
  notification-only bookkeeping fields on `Job` — they don't reflect
  anything about the job's real state and shouldn't be read by other
  modules.
- Adding a third dedup-able attention type means adding both a new
  `*DigestedAt` column and a `dedupField`/`isDedupType` branch in
  `notifications.processor.ts` — there's no generic "dedup any attention
  type" mechanism yet.
