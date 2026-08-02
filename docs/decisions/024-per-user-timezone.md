# ADR-024: Per-user timezone for reminder/digest emails

## Status
Accepted

## Date
2026-08-02

## Context

SPEC.md's original notification design locked timezones as out of scope:
digest emails fired at a fixed 08:00 UTC and interview reminders rendered
`scheduledAt` in UTC with an explicit "UTC" label. For a user outside UTC
(e.g. `Asia/Karachi`, UTC+5 — the same offset as `ROZEE` in
`DiscoverySource`), the daily digest silently arrived at 13:00 local instead
of the intended "start of day" time, and every reminder email required a
manual timezone conversion to read.

## Decision

### `User.timezone` — plain nullable-free string column, not a new model

```prisma
model User {
  timezone String @default("UTC")
}
```

No new model, no relation — same shape as `digestFrequency`/
`interviewRemindersEnabled` (ADR-019). Additive migration, no backfill
needed since every existing row gets the default.

### IANA name, validated at the DTO boundary

`UpdateNotificationPrefsDto.timezone` is checked by a custom
`IsIanaTimezone` validator (`common/validators/is-iana-timezone.validator.ts`)
against `Intl.supportedValuesOf('timeZone')` — rejecting a bad value at
write time rather than letting it reach `Intl.DateTimeFormat` inside the
scheduler/templates later, where it would throw.

**`Intl.supportedValuesOf('timeZone')` omits `'UTC'` itself** — it's a
legacy alias, not a canonical IANA zone name — even though `'UTC'` is the
column's own default. The validator's allow-list and the frontend
`<select>`'s option list both add `'UTC'` back explicitly; without this,
the DB default itself would fail validation on any round-trip PATCH, and
the frontend `<select>` would silently mismatch the saved value.

### Reminders render in the user's local time

`interviewReminderEmail` (`notifications/templates.ts`) takes a `timezone`
param and formats `scheduledAt` with `timeZoneName: 'short'` instead of a
hardcoded `+ ' UTC'` suffix. `dateStyle`/`timeStyle` can't be combined with
`timeZoneName` (Intl throws `RangeError: Invalid option`), so the
equivalent components (`year`/`month`/`day`/`hour`/`minute`) are spelled
out manually.

### Digest cron: hourly scan gated on local send hour, not a fixed UTC cron

`sendDailyDigests`/`sendWeeklyDigests` both changed from `'0 8 * * *'` /
`'0 8 * * 1'` to `CronExpression.EVERY_HOUR` (still `timeZone: 'UTC'` on the
cron itself — only the trigger cadence changed). `fanOutDigest` computes
each user's local hour/weekday via `Intl.DateTimeFormat` and skips anyone
not at their local 08:00 (plus local Monday for the weekly variant).

The per-user dedup `jobId` (`digest-${frequency}-${userId}-${dateKey}`)
switched from the UTC calendar date (`new Date().toISOString().slice(0,
10)`) to the user's **local** calendar date (`Intl.DateTimeFormat('en-CA',
{ timeZone })`). Keeping the UTC date here would let a user near a
UTC-midnight boundary get two digests mapped to one local day, defeating
the dedup key's purpose.

A malformed `timezone` (e.g. hand-edited via Prisma Studio — direct DB
edits are a normal ops path in this app; see backend `CLAUDE.md`'s admin
section) throws out of `Intl.DateTimeFormat`. That's caught per-user inside
`fanOutDigest`'s loop and logged (`digest_invalid_timezone`) rather than
allowed to abort the whole hourly tick — one bad row must not silently skip
every other user's digest that hour.

### Frontend: `<select>` loaded client-only via `next/dynamic({ ssr: false })`

`Intl.supportedValuesOf('timeZone')` depends on the runtime's bundled ICU
data. Node (SSR) and the browser (hydration) can disagree on the exact zone
list/order — this was caught as a live hydration mismatch during review (a
`<select>` with ~400 `<option>`s rendered a different list server-side vs.
client-side, and React discarded/re-rendered the whole tree as a result).
The timezone field (`components/profile/timezone-field.tsx`) is loaded via
`next/dynamic(..., { ssr: false })` so it never renders on the server —
both `Intl` calls only ever run in the browser, and there's nothing left to
mismatch.

## Alternatives Considered

### UTC-offset integer instead of an IANA name
Rejected: doesn't handle DST transitions (a fixed offset drifts twice a
year for any DST-observing region), and IANA names are what `Intl` APIs
already accept directly — no conversion layer needed.

### Timezone auto-detected server-side (e.g. from IP/geolocation)
Rejected: adds a new external dependency and a privacy-sensitive data path
for a personal single-user tool where the browser already knows this for
free (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The "Use my
timezone" button on `/profile` surfaces that value as a one-click default
instead.

### Keep the fixed daily/weekly cron, compute per-user delay via `setTimeout`
Rejected: reintroduces exactly the kind of ad-hoc scheduling state
(surviving restarts, avoiding duplicate timers) that `@nestjs/schedule` +
BullMQ already solve. An hourly scan with a cheap gate check is simpler and
consistent with the existing `scanInterviewReminders` hourly-scan pattern.

## Consequences
- Digest fan-out now runs 24x/day instead of 1x/day (still cheap at
  single-user/personal-tool scale — the query only selects `id`/`timezone`
  and skips everyone not at their local hour before doing any heavier
  attention-item work).
- A timezone with a non-whole-hour UTC offset (e.g. `Asia/Kolkata`,
  `Asia/Kathmandu`, `Australia/Adelaide`) still gets its digest within the
  same UTC hour their local 08:00 falls in, not to the exact minute — an
  inherent granularity limit of the hourly-scan design, same trade-off
  `scanInterviewReminders` already accepts for its 24h reminder window.
- A user who changes `timezone` mid-cycle could, in principle, see a digest
  arrive twice for what was one "local day" under the old zone (the dedup
  key's local-date component changes when the zone does). Accepted as a
  rare, low-severity edge case rather than something worth complicating the
  dedup key over.
