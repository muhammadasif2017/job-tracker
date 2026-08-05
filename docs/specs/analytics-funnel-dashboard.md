# Spec: Analytics Funnel Dashboard

## Objective

Give the user a deeper view of their job search pipeline beyond current-status
counts: which stages jobs reach, where they drop off, how long they linger per
stage, and which application source responds best. Derived entirely from
existing `Job`/`JobEvent` data — no new state.

**User stories:**
- As a user, I can see how many applications reached each funnel stage (Wishlist → Applied → Interviewing → Offer) and how many dropped off (Rejected / Ghosted)
- As a user, I can see average time spent in each stage before moving on
- As a user, I can see my response rate broken down by source (LinkedIn, Referral, etc.)

## Tech Stack

Existing stack only — no new dependencies, no schema/migration changes.

## Commands

```bash
# Backend
cd backend && npx tsc --noEmit && npm run test:e2e

# Frontend
cd frontend && npm run lint && npm test
```

## Project Structure

```
backend/src/modules/jobs/
  jobs.controller.ts        # + GET /jobs/stats/funnel
  jobs.service.ts            # + getFunnel(userId)
  jobs.service.spec.ts       # + describe('getFunnel')
  dto/funnel-stats.dto.ts    # new

frontend/
  types/index.ts                          # + FunnelStats type
  components/dashboard/funnel-chart.tsx   # new
  components/dashboard/funnel-chart.test.tsx  # new
  app/(dashboard)/page.tsx                # + funnel section
  e2e/dashboard.spec.ts                   # + funnel assertions
```

## API Changes

### New: `GET /jobs/stats/funnel`

Registered above `:id` in the controller (same reason as `stats`/`export`/`attention`).

Response shape:

```ts
{
  funnel: { status: 'WISHLIST'|'APPLIED'|'INTERVIEWING'|'OFFER', reached: number }[],
  dropoff: { status: 'REJECTED'|'GHOSTED', count: number }[],
  avgTimeInStageDays: Partial<Record<JobStatus, number>>, // stage absent if no closed interval yet
  responseRateBySource: { source: JobSource | 'UNSPECIFIED', total: number, responseRate: number }[],
}
```

## Computation Logic

- **`funnel.reached`** — distinct-job count of `JobEvent` rows with `toStatus = <stage>`, scoped to the user's jobs. Event-sourced, not current-status: a job now at `OFFER` still counts toward `INTERVIEWING`'s reached total. (Not a strict monotonic path — a job created directly at `APPLIED` never counts toward `WISHLIST`; that's correct, not a bug.)
- **`dropoff`** — current `Job.status` counts for `REJECTED`/`GHOSTED` (terminal states, so current status == reached).
- **`avgTimeInStageDays`** — per job, order events by `createdAt`; for each consecutive pair, the gap is attributed to the *earlier* event's `toStatus`. Average each stage's gaps (in days) across all jobs. A job's current (last, open-ended) stage is excluded — only closed intervals count. Stage key omitted entirely if zero closed intervals exist.
- **`responseRateBySource`** — `Job.groupBy(['source','status'])` for the user; `null` source bucketed as `'UNSPECIFIED'`. Per source: `responseRate = (INTERVIEWING+OFFER+REJECTED)/total * 100`, rounded to 1dp — same formula as existing `GET /jobs/stats`.

All computed in a single service method, 2 Prisma queries (`jobEvent.findMany` + `job.groupBy`), grouping done in JS.

## Frontend

`FunnelChart` component, `['analytics', 'funnel']` query key, `staleTime: 60_000` (matches existing convention). Renders:
- Funnel bar (recharts `BarChart`, reusing the palette from `status-chart.tsx`)
- Dropoff counts as small text stats
- Avg time-in-stage as a simple list (stage → "N.N days", or "—" if absent)
- Response rate by source as a small table/list

Placed as a new section on `app/(dashboard)/page.tsx` below the existing status chart / recent activity grid. Empty-state ("No data yet") mirrors `StatusChart`'s existing pattern.

## Testing Strategy

- **Backend**: unit tests in `jobs.service.spec.ts` (`describe('getFunnel')`) following the existing mock-Prisma pattern — zero-data case, multi-job case verifying reached counts / dropoff / avg-time / per-source rate math. No e2e test added (backend e2e suite tests real flows, not analytics math — consistent with how `getStats` isn't separately e2e-tested beyond smoke coverage).
- **Frontend**: unit test `funnel-chart.test.tsx` (Vitest + Testing Library, following existing component test conventions) covering empty state and populated render. Playwright case added to `e2e/dashboard.spec.ts`: fresh account shows funnel empty state; after creating a job, funnel section renders without erroring.

## Boundaries

- Always: reuse existing `responseRate` formula rather than inventing a new one; zero-fill/omit rather than throwing on no-data.
- Ask first: nothing — no schema change, no new deps, no new env vars.
- Never: touch existing `GET /jobs/stats` endpoint/DTO/tests.

## Success Criteria

- `GET /jobs/stats/funnel` returns correct shape and passes new unit tests
- `npx tsc --noEmit` clean, `npm run test:e2e` (backend) unaffected
- Frontend: `npm test` and `npm run lint` clean; new Playwright case passes against local dev servers
- Dashboard renders the funnel section correctly for both empty and populated accounts

## Open Questions

None — scope confirmed with user.
