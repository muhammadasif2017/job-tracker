# ADR-043: An interview round carries a time of day and a length

## Status
Accepted

## Date
2026-09-10

## Context

ADR-034 pinned `Job.appliedAt` as a civil date and, in the same breath, named
`nextInterviewAt` and `InterviewRound.scheduledAt` as the opposite — **real
instants**, because "an interview happens at a time, the attention list filters
them on a 48-hour window, and reminder emails schedule off them."

The storage and the read paths were built that way. The write path never was.
`CreateInterviewRoundDto.scheduledAt` was documented `format: 'date'`, the form
rendered `<input type="date">`, and `new Date('2026-11-05')` stored UTC
midnight. So every round in the system was a civil date wearing an instant's
column, and the codebase said so in two places that contradicted each other:

- `interview-rounds.service.ts` argued at length that `scheduledAt` is
  "date-only in intent (the form only ever offers a bare date picker)" and
  emitted an RFC 5545 all-day `VALUE=DATE` event on the strength of it.
- `frontend/lib/utils.ts` said the field is a real instant and rendered it
  through `formatDate`, which reads *local* getters.

Both cannot be true. For a user west of UTC the round list displayed the day
before the one stored, and the calendar export displayed a third answer.

Two further gaps followed from the same root:

- The UI had no way to change a round's date at all. Correcting a typo meant
  deleting the round and adding it again, which left the original
  `INTERVIEW_ROUND_ADDED` Timeline event behind with no round to match.
- The Timeline note carried the stage string alone, so an entry read
  `→ Phone Screen` with no indication of when the interview actually was.

## Decision

**`InterviewRound.scheduledAt` is a real instant with a real time of day, and
every round carries a length.** This completes ADR-034's stated position rather
than reversing it.

### 1. The form asks for a time, and the client resolves it

`<input type="datetime-local">` on both the create and the edit path. Its value
(`2026-11-19T14:00`) carries **no UTC offset**, and per ECMAScript a date-*time*
string without an offset parses as the *host's local* time while a bare date
parses as UTC. Sent raw, the same request would mean different instants on a
UTC dev container and a non-UTC production host — the exact class of bug
ADR-034 was written about, and invisible to a test suite that runs in UTC.

So the browser converts to a real instant before sending, and
`HasUtcOffset` (`backend/src/common/validators/`) rejects an offset-less
date-time at the edge rather than leaving the ambiguity latent.

### 2. `durationMinutes` is user-supplied, not inferred

An interview's length is the user's knowledge, not something to guess from the
stage name. It is required by `CreateInterviewRoundDto` (5–1440) and nullable in
the column, which is not a contradiction: rounds written before this ADR never
recorded one. Those read null and the calendar export falls back to
`DEFAULT_ROUND_MINUTES`.

The ICS export stops being an all-day event. `DTSTART` is the stored instant and
`DTEND` is that plus the length, both through `formatIcsDate`.
`formatIcsDateOnly` and the comment justifying it are deleted.

### 3. The Timeline note is a frozen snapshot

`JobEvent.note` gains the scheduled slot alongside the stage —
`Phone Screen - Nov 19, 2026, 2:00 PM GMT+5` — resolved in the user's own
`User.timezone` at **write** time, since `JobEvent` has no reference to the
round and nothing to re-read at render time. A later reschedule does not rewrite
the note. The round list is the live view of when the interview is; the Timeline
is the log of what was decided when.

## Consequences

- **Rounds may now be edited in place.** A stage, time, length or note can be
  corrected without the delete-and-re-add workaround. The client sends only the
  fields that actually changed: `InterviewRoundsService.update` clears
  `reminderSentAt` whenever `scheduledAt` is present, so resending an unchanged
  time would re-arm a reminder that already went out.
- **Existing rounds display as `12:00 AM`.** Deliberately not backfilled, for
  ADR-034's reason: the value would be a guess at something nobody recorded, and
  a backfill writes production rows on merge rather than only changing the
  schema. They normalize on the next edit.
- **`update()` now enqueues a timeline-summary regen**, which it never did while
  only `create()` did. A rescheduled round otherwise left the old time in the
  generated narrative — the stale-data complaint that prompted this work.
- **The 24-hour reminder window is now genuinely time-sensitive.** A round
  earlier today and one later today are no longer the same value to
  `NotificationsScheduler`.
- **`deriveInterviewRoundStatus` flips mid-day.** `scheduledAt < now` moves a
  round to `AWAITING_RESPONSE` when the interview ends, not at the following
  midnight. That is the intended reading of a field that now has a time.
- The migration is additive (`ADD COLUMN`, nullable, no default), so it destroys
  nothing when it reaches production on merge.

## Alternatives considered

### Make `scheduledAt` a civil date for real, matching the old form
Rejected. It contradicts ADR-034 and would break the two features that already
depend on a time — the 48-hour attention window and reminder emails — to
preserve a form input nobody asked for. The user's request was explicitly for a
time of day.

### Infer the length from the stage name
Rejected. "Onsite" means four hours at one company and ninety minutes at
another. Guessing produces a calendar entry that is quietly wrong, which is
worse than asking once at create time.

### Store the end time instead of a duration
Equivalent in expressiveness and worse to edit: moving an interview an hour
later would mean changing two fields consistently rather than one.

### Give `JobEvent` a nullable `interviewRoundId` so the Timeline reads live
Deferred, not rejected. It is the honest model and it would also let a deleted
round clean up its own Timeline entry — the stale-entry bug that surfaced
alongside this work. It is a second migration and a wider change; the snapshot
note delivers the user-visible half now.
