# Plan: Split Job Source into Discovery Source + Application Channel

Spec: [specs/split-job-source-discovery-channel.md](specs/split-job-source-discovery-channel.md)

Open questions from the spec resolved with the spec's stated defaults (no objection raised): `LINKEDIN`/`LINKEDIN_JOBS` stay split, URL-guess fills `applicationChannel`, table shows `applicationChannel` badge only, hard cutover (no `source` compat period).

## Component Map & Dependencies

```
[1] DB schema + migration (backfill)
      ↓
[2] Backend DTOs (create/update/response/parsed/funnel-stats)
      ↓
[3] jobs.service.ts (guessSourceFromUrl, create/update, getFunnelStats, CSV export)
      ↓
[4] Backend tests (funnel groupBy, URL-guess mapping)
      ↓
[5] Frontend types.ts (enums, labels, colors, Job type, funnel type)
      ↓
[6] Frontend badge.tsx (kind-aware SourceBadge)
      ↓
[7] job-form.tsx (two selects)         [8] quick-add.tsx (channel from URL-guess)
      ↓                                       ↓
[9] jobs/page.tsx table            [10] jobs/[id]/page.tsx detail
      ↓
[11] funnel-chart.tsx + test
      ↓
[12] Full verification pass (backend test:e2e, frontend build/test)
```

Steps 7 and 8 both depend on 6, can run in either order. Steps 9 and 10 both depend on 6, can run in parallel. Step 11 depends on 3+5.

## Risks

| Risk | Mitigation |
|---|---|
| Auto-generated migration drops `source` with no backfill | Use `--create-only`, hand-edit SQL to insert backfill `UPDATE`s before the `DROP COLUMN`/`DROP TYPE`, review diff before applying |
| Backfill mapping silently wrong for edge values | Mapping table lives in the spec; migration SQL reviewed against it line-by-line before apply; spot-check via `prisma studio` post-migration |
| `groupBy(['applicationChannel','status'])` behaves differently from `['source','status']` for null values | Existing `'UNSPECIFIED'` fallback logic in `getFunnelStats` reused as-is, just re-keyed to the new field |
| Frontend badge component used in 3 places (table, detail, funnel) breaks silently if not all call sites updated | Grep for every `SourceBadge` usage before considering step 6 done, not just the ones in the file inventory |
| e2e suite runs against live shared dev DB — a bad migration affects everyone | Migration is applied only after explicit user go-ahead (per CLAUDE.md), and only after step 1's SQL is reviewed |

## Tasks

- [ ] **Task 1: DB schema + migration**
  - Add `DiscoverySource`/`ApplicationChannel` enums, add `Job.discoverySource`/`Job.applicationChannel`, drop `Job.source`/`JobSource`
  - `npx prisma migrate dev --name split_job_source_into_discovery_and_channel --create-only`, hand-edit SQL to add backfill `UPDATE`s per spec's Code Style section, **stop and get user confirmation before running the apply step**
  - Verify: after apply, `npx prisma generate` succeeds; spot-check a few rows in `prisma studio` match the mapping table
  - Files: `backend/prisma/schema.prisma`, new migration folder

- [ ] **Task 2: Backend DTOs**
  - `create-job.dto.ts`, `job-response.dto.ts`, `parsed-job.dto.ts`, `funnel-stats.dto.ts` — `source` → `discoverySource`/`applicationChannel` per spec's file inventory
  - Verify: `npx tsc --noEmit` passes
  - Files: `backend/src/modules/jobs/dto/*.ts`

- [ ] **Task 3: jobs.service.ts**
  - `guessSourceFromUrl` retyped to return `ApplicationChannel`; `create()`/`update()` wire both new fields; `getFunnelStats` groupBy switches to `applicationChannel`; CSV export gets two columns
  - Verify: `npx tsc --noEmit` passes
  - Files: `backend/src/modules/jobs/jobs.service.ts`

- [ ] **Task 4: Backend tests**
  - Update funnel groupBy tests to `applicationChannel` (keep all existing per-value cases, add `ATS`), update URL-guess mapping tests to assert `applicationChannel`
  - Verify: `npm run test:e2e` passes
  - Files: `backend/src/modules/jobs/jobs.service.spec.ts`

- [ ] **Task 5: Frontend types**
  - Split `JOB_SOURCES`/`SOURCE_LABELS`/`SOURCE_COLORS` into `DISCOVERY_SOURCES`/`DISCOVERY_SOURCE_LABELS`/`DISCOVERY_SOURCE_COLORS` and `APPLICATION_CHANNELS`/`APPLICATION_CHANNEL_LABELS`/`APPLICATION_CHANNEL_COLORS`; update `Job` type and funnel type
  - Verify: `npx tsc --noEmit` (or build) passes
  - Files: `frontend/types/index.ts`

- [ ] **Task 6: SourceBadge**
  - Add `kind: 'discovery' | 'channel'` prop selecting the right label/color map
  - Verify: grep every `SourceBadge` call site, confirm all pass `kind`
  - Files: `frontend/components/ui/badge.tsx`

- [ ] **Task 7: job-form.tsx**
  - Two `<select>`s, two Zod fields, both optional, both submit-mapped `''→undefined`
  - Verify: manual create/edit round-trip in the running app
  - Files: `frontend/components/jobs/job-form.tsx`

- [ ] **Task 8: quick-add.tsx**
  - Extracted URL-guess result sets `applicationChannel` field on the form (not a generic `source`)
  - Verify: paste a linkedin.com job URL in Quick Add, confirm channel pre-fills
  - Files: `frontend/components/jobs/quick-add.tsx`

- [ ] **Task 9: jobs/page.tsx table**
  - Table badge column reads `applicationChannel`
  - Verify: table renders badges without crashing on jobs with only one of the two fields set
  - Files: `frontend/app/(dashboard)/jobs/page.tsx`

- [ ] **Task 10: jobs/[id]/page.tsx detail**
  - Detail view shows both badges (discovery + channel)
  - Verify: open a job detail page, both badges render (or "—" when unset)
  - Files: `frontend/app/(dashboard)/jobs/[id]/page.tsx`

- [ ] **Task 11: funnel-chart.tsx**
  - Reads `applicationChannel` from the funnel response; update `funnel-chart.test.tsx` per-value assertions
  - Verify: `npm test` passes
  - Files: `frontend/components/dashboard/funnel-chart.tsx`, `funnel-chart.test.tsx`

- [ ] **Task 12: Full verification**
  - `backend: npx tsc --noEmit && npm run test:e2e`; `frontend: npm run build && npm test && npm run lint`
  - Manual smoke test: create job with both fields, edit, Quick Add from URL, check table/detail/funnel
  - Files: none (verification only)
