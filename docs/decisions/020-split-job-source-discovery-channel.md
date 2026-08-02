# ADR-020: Split `JobSource` into `DiscoverySource` and `ApplicationChannel`

## Status
Accepted

## Date
2026-08-02

## Context

`Job.source` was a single `JobSource` enum (`LINKEDIN`, `INDEED`, `ROZEE`,
`COMPANY_WEBSITE`, `REFERRAL`, `CAREER_EMAIL`, `OTHER`) answering two
different questions at once: *where did I find this job?* and *how did I
apply to it?* The two frequently diverge — a job found via `LINKEDIN`
(discovery) is very often applied to through the company's own `ATS` or
`COMPANY_WEBSITE` (channel), not through LinkedIn itself. One field could
only record one answer, forcing a lossy choice on every job entry.

`responseRateBySource` in `getFunnelStats` (funnel stats) is a rate over
*how you applied*, not where you saw the posting — a single conflated field
made that stat ambiguous about which question it was answering.

## Decision

Replace the one `source` column with two independent nullable columns:

```prisma
enum DiscoverySource {
  LINKEDIN
  LINKEDIN_JOBS
  GOOGLE_SEARCH
  INDEED
  ROZEE
  REFERRAL
  CAREER_EMAIL
  OTHER
}

enum ApplicationChannel {
  COMPANY_WEBSITE
  ATS
  LINKEDIN
  INDEED
  ROZEE
  REFERRAL
  CAREER_EMAIL
  OTHER
}

model Job {
  discoverySource     DiscoverySource?
  applicationChannel  ApplicationChannel?
}
```

The two enums are not identical: `DiscoverySource` adds `LINKEDIN_JOBS` and
`GOOGLE_SEARCH` (ways to *find* a posting that aren't application paths);
`ApplicationChannel` adds `ATS` and `COMPANY_WEBSITE` (ways to *apply* that
aren't discovery paths). Kept as two separate enums rather than one shared
enum with both fields pointing at it, so each can grow its own members
without polluting the other's value set.

### Funnel stats group by `applicationChannel`, not `discoverySource`
`responseRateBySource` in `jobs.service.ts` groups by `applicationChannel`.
Response rate is a function of the application path (does an `ATS` swallow
your resume, does a referral get read faster) — discovery source is
irrelevant to that question.

### Migration: backfill both columns, then drop the old one, same-name best effort
```sql
UPDATE "Job" SET "discoverySource" = CASE "source"
  WHEN 'LINKEDIN' THEN 'LINKEDIN'::"DiscoverySource"
  ...
  ELSE 'OTHER'::"DiscoverySource"
END WHERE "source" IS NOT NULL;
-- mirrored for applicationChannel
ALTER TABLE "Job" DROP COLUMN "source";
DROP TYPE "JobSource";
```
Every existing non-null `source` value is copied into *both* new columns
(mapped to `OTHER` where the old value has no equivalent member in that
target enum, e.g. old `COMPANY_WEBSITE` → `OTHER` for `discoverySource`).
This is a deliberate over-approximation: existing rows get a plausible value
in both fields rather than a `null` in one, since the old single field's
value was actually true of *at least one* of the two new questions for every
enum member. Users can correct the other field later; there's no way to
recover which one was "true" for old data, since it was never captured.

## Alternatives Considered

### Keep one `source` field, add a second free-text field for the other axis
Rejected: loses filtering/grouping (`groupBy`, funnel stats) on the free-text
side, and doesn't fix the original ambiguity — still only one enum-backed
axis to query on.

### One shared enum reused by both columns
Would avoid the two enums having overlapping members (`LINKEDIN`, `INDEED`,
`ROZEE`, `REFERRAL`, `CAREER_EMAIL`, `OTHER` appear in both). Rejected:
`LINKEDIN_JOBS` / `GOOGLE_SEARCH` are meaningless as an application channel,
and `ATS` / `COMPANY_WEBSITE` are meaningless as a discovery source; a shared
enum would let either column accept nonsensical values with no DB-level
guard against it.

### Backfill only `discoverySource` (old field's original intent) and leave `applicationChannel` null
Rejected: `source` was already being used inconsistently as both in
practice (see `guessSourceFromUrl` in `jobs.service.ts`, which inferred it
from the application URL — clearly a channel signal, not a discovery one).
Populating both from the same old value is the more honest reflection of
how the field was actually used, and gives `responseRateBySource` real
historical data on day one instead of a wall of `UNSPECIFIED`.

## Consequences
- `guessSourceFromUrl` (URL-domain sniffing during Quick Add extraction) now
  only ever sets `applicationChannel` — it infers from the application URL,
  which is a channel signal, never a discovery one.
- CSV export (`jobs.service.ts` export path) emits two columns, "Discovery
  Source" and "Application Channel", instead of one "Source" column —
  external consumers of the old export format need to adjust.
- Any future analytics that want a combined "source" view (e.g. "how many
  jobs came in via LinkedIn in any capacity") must explicitly union both
  fields; there's no single column to group by anymore.
- Adding a new source/channel value now requires deciding which enum (or
  both) it belongs to, rather than a single append.
