# Spec: Split Job Source into Discovery Source + Application Channel

## Objective

Replace the single `Job.source` field with two fields: `discoverySource` (where the job posting was first seen — LinkedIn post/share, LinkedIn Jobs feature, Google search, Indeed, Rozee, referral, career email) and `applicationChannel` (where the application was actually submitted — company website, ATS like Greenhouse/Lever, Indeed, Rozee, referral, career email). Today one `JobSource` value has to stand in for both, so a job found via a LinkedIn post but applied through Greenhouse loses one half of that story no matter which value is picked. Success: user can record both hops, see both in the form/detail/table, and the response-rate funnel groups by the one that's actually actionable (application channel).

**User stories:**
- As a user, I can record where I first saw a job (discovery) and where I applied (channel) as two separate pickers.
- As a user, I can still Quick-Add from a URL and have the channel auto-guessed from the domain, same as today.
- As a user, I see both values on the job detail page and can filter/report on either.
- As a user, my existing jobs keep a sensible value in both new fields after the migration — no data loss, no forced re-entry.

## Assumptions

1. **Two separate enums**, not one shared enum (per your choice):
   - `DiscoverySource`: `LINKEDIN, LINKEDIN_JOBS, GOOGLE_SEARCH, INDEED, ROZEE, REFERRAL, CAREER_EMAIL, OTHER`
   - `ApplicationChannel`: `COMPANY_WEBSITE, ATS, LINKEDIN, INDEED, ROZEE, REFERRAL, CAREER_EMAIL, OTHER`
   - `LINKEDIN` (post/share) vs `LINKEDIN_JOBS` (official Jobs feature) are distinct discovery values per your original description. Correct me if you want them merged.
   - `ROZEE` is included in `ApplicationChannel` (not just discovery) since `guessSourceFromUrl` already treats `rozee.pk` as a URL you apply through, same as `linkedin.com`/`indeed.com`.
2. **Backfill: copy old `source` into both new fields**, best-effort, same enum-member-name where it exists in the target enum, else `OTHER`:
   - `discoverySource`: `LINKEDIN→LINKEDIN, INDEED→INDEED, ROZEE→ROZEE, COMPANY_WEBSITE→OTHER, REFERRAL→REFERRAL, CAREER_EMAIL→CAREER_EMAIL, OTHER→OTHER`
   - `applicationChannel`: `LINKEDIN→LINKEDIN, INDEED→INDEED, ROZEE→ROZEE, COMPANY_WEBSITE→COMPANY_WEBSITE, REFERRAL→REFERRAL, CAREER_EMAIL→CAREER_EMAIL, OTHER→OTHER`
   - Only `COMPANY_WEBSITE→OTHER` (discovery side) is lossy in this mapping — flagging since "copy into both" can't be literal when the two enums don't share every member.
3. **Funnel/response-rate uses `applicationChannel`** (per your choice) — `getFunnelStats`'s `groupBy` switches from `source` to `applicationChannel`; `discoverySource` is not part of the funnel.
4. **`guessSourceFromUrl` populates `applicationChannel`, not `discoverySource`.** The URL a user pastes into Quick Add is where they'd apply (or the posting redirects there), so it maps more naturally to channel. `discoverySource` has no auto-guess — always a manual pick, defaults empty. Correct me if you'd rather guess discovery from the URL instead (or both).
5. `JobSource` enum and the `source` column are dropped entirely after backfill — this is a hard cutover, not an additive change (unlike `CAREER_EMAIL`'s addition). No dual-write/compat period.
6. CSV export gets two columns (`Discovery Source`, `Application Channel`) replacing the single `Source` column.
7. Table view (`jobs/page.tsx`) shows `applicationChannel` as the primary badge (matches funnel's business focus); detail page (`[id]/page.tsx`) shows both. Correct me if you want both columns in the table.

## Tech Stack

Existing stack, no new dependencies: NestJS + Prisma 7 + PostgreSQL (backend), Next.js 16 + TanStack Query + RHF/Zod (frontend).

## Commands

```
Backend migrate (create-only, for hand-editing backfill SQL):
  npx prisma migrate dev --name split_job_source_into_discovery_and_channel --create-only
  (run from backend/, requires user OK per CLAUDE.md — touches shared dev DB)
Backend apply:    npx prisma migrate dev
Backend generate: npx prisma generate
Backend test:     npm run test:e2e            (backend/)
Backend types:    npx tsc --noEmit             (backend/)
Frontend test:    npm test                     (frontend/)
Frontend build:   npm run build                (frontend/)
Frontend lint:    npm run lint
```

## Project Structure (files touched)

```
backend/prisma/schema.prisma
  → drop enum JobSource, drop Job.source
  → add enum DiscoverySource, enum ApplicationChannel
  → add Job.discoverySource DiscoverySource?, Job.applicationChannel ApplicationChannel?

backend/prisma/migrations/<ts>_split_job_source_into_discovery_and_channel/migration.sql
  → generated skeleton via --create-only, then hand-edited to insert backfill
    UPDATE statements (per Assumption 2 mapping) between the ADD COLUMN and
    DROP COLUMN/DROP TYPE statements — plain `prisma migrate dev` would
    generate a destructive drop with no backfill.

backend/src/modules/jobs/dto/create-job.dto.ts        → source → discoverySource?, applicationChannel?
backend/src/modules/jobs/dto/update-job.dto.ts        → (extends CreateJobDto via PartialType, verify)
backend/src/modules/jobs/dto/job-response.dto.ts      → source → discoverySource, applicationChannel
backend/src/modules/jobs/dto/parsed-job.dto.ts        → source → applicationChannel (Quick Add URL-guess result)
backend/src/modules/jobs/dto/funnel-stats.dto.ts      → SourceResponseRateDto.source: ApplicationChannel | 'UNSPECIFIED'
backend/src/modules/jobs/jobs.service.ts
  → SOURCE_DOMAINS + guessSourceFromUrl(): return type ApplicationChannel, unchanged domain map
  → create(): dto.discoverySource passthrough; dto.applicationChannel ?? guessSourceFromUrl(url)
  → getFunnelStats(): groupBy(['applicationChannel','status']) instead of ['source','status']
  → CSV export: two columns, 'Discovery Source' + 'Application Channel'
backend/src/modules/jobs/jobs.controller.ts           → Swagger doc string update only (funnel description)

frontend/types/index.ts
  → JOB_SOURCES/SOURCE_LABELS/SOURCE_COLORS split into
    DISCOVERY_SOURCES/DISCOVERY_SOURCE_LABELS/DISCOVERY_SOURCE_COLORS and
    APPLICATION_CHANNELS/APPLICATION_CHANNEL_LABELS/APPLICATION_CHANNEL_COLORS
  → Job.source? → Job.discoverySource?, Job.applicationChannel?
  → funnel type: source → applicationChannel field name
frontend/components/jobs/job-form.tsx     → two <select>s + two Zod fields, replacing the one
frontend/components/jobs/quick-add.tsx    → extracted URL-guess sets applicationChannel field
frontend/components/ui/badge.tsx          → SourceBadge takes a `kind: 'discovery' | 'channel'` prop (or split into two badge components) selecting the right label/color map
frontend/app/(dashboard)/jobs/page.tsx    → table badge column uses applicationChannel
frontend/app/(dashboard)/jobs/[id]/page.tsx → detail view shows both badges
frontend/components/dashboard/funnel-chart.tsx → reads applicationChannel field from funnel response
```

## Data Model

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
  // ...
  discoverySource    DiscoverySource?
  applicationChannel ApplicationChannel?
  // source JobSource?  ← removed
}
```

## Code Style

Match the existing enum-extension migration pattern (`20260716085911_add_job_source`, `20260802083544_add_career_email_job_source`) for naming, but this migration needs hand-written backfill SQL, not just `CREATE TYPE`/`ALTER TYPE`:

```sql
-- after CREATE TYPE "DiscoverySource" / "ApplicationChannel" and ADD COLUMN:

UPDATE "Job" SET "discoverySource" = CASE "source"
  WHEN 'LINKEDIN' THEN 'LINKEDIN'::"DiscoverySource"
  WHEN 'INDEED' THEN 'INDEED'::"DiscoverySource"
  WHEN 'ROZEE' THEN 'ROZEE'::"DiscoverySource"
  WHEN 'REFERRAL' THEN 'REFERRAL'::"DiscoverySource"
  WHEN 'CAREER_EMAIL' THEN 'CAREER_EMAIL'::"DiscoverySource"
  ELSE 'OTHER'::"DiscoverySource"
END WHERE "source" IS NOT NULL;

UPDATE "Job" SET "applicationChannel" = CASE "source"
  WHEN 'COMPANY_WEBSITE' THEN 'COMPANY_WEBSITE'::"ApplicationChannel"
  WHEN 'LINKEDIN' THEN 'LINKEDIN'::"ApplicationChannel"
  WHEN 'INDEED' THEN 'INDEED'::"ApplicationChannel"
  WHEN 'ROZEE' THEN 'ROZEE'::"ApplicationChannel"
  WHEN 'REFERRAL' THEN 'REFERRAL'::"ApplicationChannel"
  WHEN 'CAREER_EMAIL' THEN 'CAREER_EMAIL'::"ApplicationChannel"
  ELSE 'OTHER'::"ApplicationChannel"
END WHERE "source" IS NOT NULL;

-- then: ALTER TABLE "Job" DROP COLUMN "source";
--       DROP TYPE "JobSource";
```

Frontend (`types/index.ts`), keep arrays/records ordered same as the Prisma enums:

```ts
export const DISCOVERY_SOURCES = [
  'LINKEDIN', 'LINKEDIN_JOBS', 'GOOGLE_SEARCH', 'INDEED', 'ROZEE', 'REFERRAL', 'CAREER_EMAIL', 'OTHER',
] as const;

export const APPLICATION_CHANNELS = [
  'COMPANY_WEBSITE', 'ATS', 'LINKEDIN', 'INDEED', 'ROZEE', 'REFERRAL', 'CAREER_EMAIL', 'OTHER',
] as const;
```

## Testing Strategy

- Backend: `jobs.service.spec.ts` funnel tests (currently ~L534-661) move from grouping by `source` to `applicationChannel` — keep the existing per-value cases (incl. `CAREER_EMAIL`), add one for `ATS`.
- Backend: Quick Add URL-mapping tests (~L842-1008) rename to assert `applicationChannel`, not `source`.
- Backend: add one test asserting the migration backfill mapping (or a service-level unit test of the equivalent logic) if the migration SQL isn't otherwise covered by e2e.
- Frontend: `funnel-chart.test.tsx` updates its per-value assertions to `applicationChannel`.
- Frontend: `job-form` tests (if any) extended for two selects instead of one.
- Run full backend `test:e2e` — this changes the schema and is a destructive column drop.

## Boundaries

- **Always:** run `prisma generate` after the migration; run backend `test:e2e` and frontend `npm run build` before calling done.
- **Ask first:** running `prisma migrate dev --create-only` and the follow-up apply against the shared dev DB — confirm immediately before each of those two steps, not just once at spec approval, since a bad backfill on a dropped column is not reversible without a backup.
- **Never:** apply the migration without first reviewing the hand-edited SQL for the backfill `CASE` statements — the auto-generated migration alone would silently drop `source` with no backfill.

## Success Criteria

- `DiscoverySource`/`ApplicationChannel` enums exist in Postgres; `JobSource` and `Job.source` are gone; Prisma client regenerated and typechecks.
- Existing jobs have non-null `applicationChannel` (and `discoverySource` where the old value had an equivalent) matching the mapping table above — spot-checked via `prisma studio` or a query.
- Job form shows two independent selects; Quick Add still auto-fills `applicationChannel` from URL domain.
- Detail page shows both badges; table shows `applicationChannel` badge.
- Funnel chart groups response rate by `applicationChannel`, including `ATS`.
- `backend: npx tsc --noEmit`, `backend: npm run test:e2e`, `frontend: npm run build`, `frontend: npm test` all pass.

## Open Questions

1. Confirm `DiscoverySource`/`ApplicationChannel` member lists (Assumption 1) — especially whether `LINKEDIN`/`LINKEDIN_JOBS` should stay split.
2. Confirm `guessSourceFromUrl` should populate `applicationChannel` (Assumption 4), not `discoverySource`.
3. Table view: `applicationChannel` badge only, or both badges in the table row (Assumption 7)?
4. OK with a hard cutover (enum dropped, no compat period) vs. keeping `JobSource`/`source` around temporarily for rollback safety?
