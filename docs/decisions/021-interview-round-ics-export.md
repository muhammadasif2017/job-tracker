# ADR-021: ICS export for interview rounds — server-generated, no library

## Status
Accepted

## Date
2026-08-02

## Context

Interview rounds have a `scheduledAt` timestamp but no way to get onto a
user's calendar except manual entry. The ask is a "download as calendar
event" button on each round — a standard `.ics` file the browser/OS hands
to whatever calendar app is registered.

`InterviewRound` has no duration, timezone, or recurrence field — just a
single `scheduledAt: DateTime` (`TIMESTAMP(3)`, no time zone) that the rest
of the module already treats as UTC everywhere it's compared or written
(`recomputeNextInterviewAt` binds a JS `Date` rather than SQL `now()`
specifically to avoid a DB-session-timezone-dependent comparison — see
ADR-018). The export has to invent a duration and must not silently
reinterpret that UTC timestamp in server-local time.

## Decision

Generate the `.ics` file by hand in `InterviewRoundsService.exportIcs`,
returned as a string from a new `GET
/jobs/:jobId/interview-rounds/:roundId/ics` endpoint with
`Content-Type: text/calendar` and a `Content-Disposition: attachment`
header. No `.ics`-generation library (e.g. `ics`, `ical-generator`) was
added.

Key choices baked into the single-file implementation:

- **Fixed 1-hour duration.** `DEFAULT_DURATION_MS = 60 * 60 * 1000`. No
  duration field exists on `InterviewRound`; 1 hour matches what most
  calendar apps show as a placeholder for a bare start time.
- **UTC formatting via `Z` suffix**, not the server's local time zone —
  `formatIcsDate` strips milliseconds and punctuation from
  `date.toISOString()`. This matches how `scheduledAt` is already treated
  everywhere else (ADR-018).
- **RFC 5545 TEXT escaping** (`escapeIcsText`) for `SUMMARY`/`DESCRIPTION`:
  backslash escaped first so it doesn't double-escape characters escaped
  after it, then `;`, `,`, and newlines.
- **RFC 5545 §3.1 line folding at 75 octets** (`foldIcsLine`), added one
  commit after the initial implementation once it became clear
  `SUMMARY`/`DESCRIPTION` are built from user text up to 5000 chars
  (`notes`) and routinely exceed the limit. Folds on UTF-8 octet
  boundaries — walks back from the 75-octet cut point until it's not
  mid-character (`(bytes[end] & 0xc0) === 0x80`) — since the RFC limit is
  defined in octets, not JS string characters, and a naive character-index
  split can sever a multi-byte UTF-8 sequence. Each continuation line's
  budget drops to 74 octets to account for the mandatory leading space RFC
  5545 requires on folded lines.
- **CRLF line endings throughout** (`lines.map((l) =>
  this.foldIcsLine(l)).join('\r\n')` — each line is folded first, then
  joined with CRLF), required by the RFC regardless of server OS.

## Alternatives Considered

### Use an `.ics`-generation library (`ics`, `ical-generator`)
Rejected: CLAUDE.md requires justifying any new dependency by bundle size
(frontend) or necessity (backend). A single VEVENT with no recurrence, no
attendees, no timezone database lookups is a well-bounded RFC 5545 subset —
cheaper to hand-write correctly than to pull in a library's full recurrence
and timezone machinery for a feature that uses none of it.

### Store a computed `endsAt` or `durationMinutes` on `InterviewRound`
Rejected: no product requirement for variable-length interviews yet: adding
a schema field for one export path is speculative. A fixed 1-hour default
is what every calendar app already shows a user who received a bare start
time; can be revisited if durations become a real input somewhere else in
the product.

### Interpret `scheduledAt` as the server's local time zone
Rejected: would produce silently wrong calendar times the moment the app
runs on a host in a different time zone than assumed, and contradicts the
UTC convention already established for this field (ADR-017/018).

## Consequences
- The export endpoint has no query params or options — always 1 hour, always
  UTC, always includes `notes` in the description if present. Any future
  need for a shorter/longer default or a per-round override requires a
  schema change, not just a service-layer tweak.
- `foldIcsLine` and `escapeIcsText` are private to `InterviewRoundsService`;
  if a second ICS-emitting feature appears (e.g. bulk export of all
  upcoming interviews), this logic should move to a shared helper rather
  than being duplicated.
- No timezone (`VTIMEZONE`) block is emitted — relies entirely on the `Z`
  UTC suffix, which every mainstream calendar client (Google Calendar,
  Outlook, Apple Calendar) interprets correctly without one.
