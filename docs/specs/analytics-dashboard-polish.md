# Spec: Analytics Dashboard Polish

## Objective

Close gaps in the existing dashboard: one computed stat (`thisMonth`) is fetched
but never rendered, the funnel chart's supporting numbers are plain text lists,
there's no view of application volume over time, and there's no way to scope
any of it to a recent window. All four ship together since the date-range
filter cuts across the other three.

**User stories:**
- As a user, I see how many applications I've submitted this calendar month on the dashboard.
- As a user, I see dropoff / avg-time-in-stage / response-rate-by-source as small charts, not text lists.
- As a user, I see a chart of application volume over time (new apps per period + running total).
- As a user, I can scope the whole dashboard to the last 30 days, last 90 days, or all time.

## Tech Stack

Existing stack only — no new dependencies. Recharts (already used by `StatusChart`/`FunnelChart`) covers the new trend chart (`ComposedChart` = `Bar` + `Line`).

## Commands

```bash
# Backend
cd backend && npx tsc --noEmit && npm run test:e2e

# Frontend
cd frontend && npm run lint && npm test && npm run build
```

## Project Structure

```
backend/src/modules/jobs/
  jobs.controller.ts         # GET /jobs/stats, /stats/funnel gain ?range=; + GET /jobs/stats/trend
  jobs.service.ts             # getStats/getFunnel gain range param; + getTrend(userId, range)
  jobs.service.spec.ts        # + range-filtering cases on getStats/getFunnel; + describe('getTrend')
  jobs.constants.ts           # + RANGE_TO_DAYS map, rangeToCutoff() helper
  dto/stats-query.dto.ts      # new — validates ?range=
  dto/job-stats.dto.ts        # unchanged shape
  dto/funnel-stats.dto.ts     # unchanged shape
  dto/trend-stats.dto.ts      # new

frontend/
  types/index.ts                            # + DashboardRange, TrendStats types
  components/dashboard/date-range-select.tsx   # new — segmented control (30d/90d/All)
  components/dashboard/trend-chart.tsx         # new
  components/dashboard/trend-chart.test.tsx    # new
  components/dashboard/funnel-chart.tsx        # dropoff/avg-time/response-rate blocks become mini charts
  components/dashboard/funnel-chart.test.tsx   # updated assertions for new markup
  components/dashboard/stats-card.tsx          # unchanged (reused for thisMonth card)
  app/(dashboard)/page.tsx                     # + range state, thisMonth StatsCard, trend section
  e2e/dashboard.spec.ts                        # + range selector + trend assertions
```

## API Changes

### `?range=30d|90d|all` on `GET /jobs/stats` and `GET /jobs/stats/funnel`

Optional query param, validated via `StatsQueryDto` (`@IsOptional() @IsIn(['30d','90d','all'])`). **Omitted = `'all'`** — identical to today's behavior, so existing tests/consumers are unaffected.

Filters by `appliedAt >= cutoff`:
- `getStats`: adds `appliedAt: { gte: cutoff }` to the existing `job.count`/`groupBy` where clauses. **`thisMonth` is exempt** — it's always "applications this calendar month" regardless of `range`, computed the same way as today.
- `getFunnel`: adds `job: { userId, appliedAt: { gte: cutoff } }` to the `jobEvent.findMany` where clause (filters by the *job's* appliedAt, not event `createdAt`), and the same `appliedAt` filter to the `job.groupBy` for `responseRateBySource`.

### New: `GET /jobs/stats/trend?range=30d|90d|all`

Registered alongside `stats`/`stats/funnel` (above `:id`). Same `range` param, default `'all'`.

Granularity is adaptive:
| range | bucket | window |
|---|---|---|
| `30d` | day | last 30 days |
| `90d` | week | last 90 days |
| `all` | month | earliest `appliedAt` → now |

Response:
```ts
{
  granularity: 'day' | 'week' | 'month',
  buckets: {
    label: string,       // e.g. 'Jul 24' (day), 'Jul 21' (week start), 'Jul 2026' (month)
    periodStart: string, // ISO date
    count: number,       // new applications (appliedAt) in this bucket
    cumulative: number,  // running total up to end of this bucket
  }[],
}
```
`range: 'all'` with zero jobs → `buckets: []`. `cumulative` at the last bucket equals the range-filtered total (matches `getStats().total` for the same `range`).

## Computation Logic

- **Range → cutoff**: `RANGE_TO_DAYS = { '30d': 30, '90d': 90 }` in `jobs.constants.ts`; `'all'` means no cutoff (query unfiltered). Shared helper used by all three methods so the cutoff math lives in one place.
- **Trend buckets**: single `job.findMany({ where: { userId, appliedAt: { gte: cutoff-or-undefined } }, select: { appliedAt: true } })`, then bucketed in JS by day/week/month key depending on granularity (`date-fns` `startOfDay`/`startOfWeek`/`startOfMonth` — already a frontend dependency; check if usable in backend or hand-roll with plain `Date` math to avoid adding it as a new backend dependency). Buckets are pre-filled for every period in the window (not just periods with data) so the chart doesn't skip gaps, then counts are filled in and `cumulative` is a running sum across the sorted output.

## Frontend

**`DateRangeSelect`**: small segmented control (`30d` / `90d` / `All`), lifted state in `DashboardPage` (`useState<DashboardRange>('90d')` — default to `90d`, not `all`, so the dashboard opens on a recent-activity view). Passed into all three query keys: `['stats', range]`, `['analytics', 'funnel', range]`, `['analytics', 'trend', range]`.

**`thisMonth` StatsCard**: fifth card (or replaces one of the existing four in the grid — TBD at implementation time by what reads best at `xl:grid-cols-4`; likely goes to a 5-up grid on `xl`). Label "This Month", value `stats.thisMonth`.

**`FunnelChart` mini-charts** (replacing the three text blocks at `funnel-chart.tsx:55-95`):
- Dropoff → small horizontal `BarChart` (2 bars: Rejected/Ghosted), same pattern as the funnel bar above it.
- Avg time in stage → small horizontal `BarChart`, one bar per stage present in `avgTimeInStageDays`, label suffixed "d".
- Response rate by source → small horizontal `BarChart`, one bar per source, value as `%`.
All three reuse `STATUS_DOT_COLORS`/a fixed palette for source bars, and keep the existing "—" / omit-if-empty behavior per sub-chart.

**`TrendChart`**: recharts `ComposedChart` — `Bar` for `count` (per-period new applications), `Line` for `cumulative` (secondary Y-axis). New `ChartCard` section on `app/(dashboard)/page.tsx`, below the funnel section. Empty state (`buckets: []`) reuses `EmptyChartState`.

## Testing Strategy

- **Backend** (`jobs.service.spec.ts`): range-filtering cases added to existing `getStats`/`getFunnel` describes (mock-Prisma pattern, assert the `where` clause / filtered counts change with `range`, and that omitting `range` reproduces current output exactly — regression guard for the "default = all" contract). New `describe('getTrend')`: empty case, single-bucket case, multi-bucket case per granularity (day/week/month), cumulative-sum correctness, `range=all` window starting at earliest `appliedAt`.
- **Frontend**: `trend-chart.test.tsx` (Vitest + Testing Library) — empty state, populated render. `funnel-chart.test.tsx` updated for the new mini-chart markup (was text assertions, becomes chart-presence assertions). Playwright (`dashboard.spec.ts`): range selector changes the displayed range and re-fetches (assert query re-fires or values update); trend section renders without erroring for both fresh and populated accounts; `thisMonth` card visible.

## Boundaries

- Always: default `range` to `'all'` server-side when the query param is omitted — this is the backward-compat contract existing tests rely on. Reuse `toPercent`/existing response-rate formula unchanged.
- Ask first: nothing — no schema/migration change (all three endpoints filter on the existing `appliedAt` column), no new dependencies. Flag before running `prisma migrate dev` per repo boundaries — not applicable here since no schema touched.
- Never: change the shape of `JobStatsDto`/`FunnelStatsDto` beyond adding the optional query param — existing consumers passing no `range` must get byte-identical output to today.

## Success Criteria

- `GET /jobs/stats`, `/stats/funnel` unchanged when called with no `range`; filtered correctly with `range=30d`/`90d`.
- `GET /jobs/stats/trend` returns correct bucketing/cumulative math for all three granularities and passes new unit tests.
- `npx tsc --noEmit` and `npm run test:e2e` (backend) clean.
- `npm run lint`, `npm test`, `npm run build` (frontend) clean; new Playwright cases pass against local dev servers.
- Dashboard shows: This Month card, mini-charts in place of funnel's text blocks, trend chart, working range selector — verified manually in-browser per repo convention for UI changes.

## Open Questions

None — scope and key design decisions (range field/scope, granularity, trend metric) confirmed with user.
