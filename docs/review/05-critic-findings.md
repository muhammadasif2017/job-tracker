# Job Tracker — Critic Pass: Open Flaws

> Graph-guided critique (code-review-graph MCP: architecture overview, knowledge
> gaps, hub nodes, large-function scan) plus a re-check of `02-code-review.md`
> for items still open. Pair with `01-architecture.md` and `02-code-review.md`
> (most findings there are already ✅ RESOLVED — this doc only lists what's
> still live, plus new structural findings the graph surfaced).

Severity legend:
- 🔴 High — correctness/security issue a user could actually hit.
- 🟠 Medium — real bug or design limitation under realistic use.
- 🟡 Low — cleanliness, structure, future-proofing.

---

## Priority order

| # | Finding | Severity | Why this rank |
|---|---------|----------|----------------|
| 1 | Frontend has zero unit-test coverage | 🟠 | e2e-gated merges (ADR-025) — highest fan-out code, slowest feedback loop. Biggest ongoing cost. |
| 2 | God service `jobs.service.ts` | 🟠 | Most-touched module across ADR history, still growing unchecked. Risk compounds with every new feature. |
| 3 | OAuth code store in-memory, never swept | 🟠 | Real memory leak + hard scaling ceiling, but latent — app is single-instance today. |
| 4 | Date-only fields shift a day across timezones | 🟠 | Real user-facing bug, but low-frequency (only hits users in certain UTC offsets viewing certain dates). |
| 5 | `jobs-page` ↔ `dashboard-chart` coupling | 🟡 | Architecture smell, cheap to fix, no user-facing symptom yet. |
| 6 | Email change leaves JWT email claim stale | 🟡 | Low impact — authz doesn't key off email. Correctness smell only. |
| 7 | DTO layer sprawl (607-node community) | 🟡 | Convention working as designed, just unaudited. No fix needed unless duplication found. |
| 8 | Repeated fix-cycle on interview-round sync | 🟡 | Already resolved (ADR-018). Pattern worth watching, not acting on. |
| 9 | e2e suite low cohesion / high blast radius | 🟡 | Accepted tradeoff of the merge-gate strategy, not a bug to fix. |
| 10 | `main.ts::bootstrap` untested | 🟡 | Fine for solo project. Lowest stakes of everything listed. |
| 11 | Custom URL error message unreachable for type-mismatched values | 🟡 | Cosmetic today (browser's native bubble covers the same case), but the code is misleading — worth knowing before relying on it. |

---

## Carried over from 02-code-review.md (still open)

### 🟠 OAuth code store is in-memory and never swept
**Where:** `backend/src/modules/auth/auth.service.ts` (pending-code `Map`).
**Problem:** Doesn't survive scaling/restart (hard ceiling on horizontal
scaling). No proactive sweep — a user who starts OAuth and never lands on
`/callback` leaves a dead entry in the Map forever (slow memory leak).
**Fix:** Redis with `EX 60`, or DB table + periodic cleanup. Minimum: lazy
purge of expired entries on each write.

### 🟠 Date-only fields can shift by a day across timezones
**Where:** `frontend/components/jobs/job-form.tsx` (`appliedAt: ...split('T')[0]`)
→ `backend/src/modules/jobs/jobs.service.ts` (`new Date(dto.appliedAt)`).
**Problem:** `new Date("2026-06-11")` parses as UTC midnight. User in a
negative UTC offset can see the previous day on display.
**Fix:** Store as Postgres `DATE` (no time component), or normalize to local
noon before constructing the `Date`.

### 🟡 Email change leaves the JWT's email claim stale
**Where:** `backend/src/modules/users/users.service.ts`.
**Problem:** Updating email updates the row, not the already-issued access
token. Low impact — authz keys off `sub`, not email — but a correctness smell.
**Fix:** Reissue tokens on email change, or document claims as
refresh-triggered snapshots.

---

## New findings (graph-surfaced)

### 🟠 God service: `jobs.service.ts`
**Where:** `backend/src/modules/jobs/jobs.service.ts` — 541-line file, 496-line
`JobsService` class (CRUD + stats + funnel + trend + CSV export all in one
class). Mirrored by `jobs.service.spec.ts` — 1015 lines, a single 969-line
`describe` block.
**Why it matters:** Most-touched module across ADR history with no
decomposition. Growing unchecked.
**Fix:** Split stats/funnel/trend into a dedicated `JobsStatsService`; keep
`JobsService` to CRUD + ownership checks.

### 🟠 Core frontend has zero unit-test coverage, only e2e
**Where (graph "untested hotspots," by fan-out):** `JobsPage` (82),
`ProfilePage` (74), `JobForm` (64), `Contacts` (64), `InterviewRounds` (64),
`JobDetailPage` (59), `ResumeUpload` (47), `KanbanBoard` (36).
**Why it matters:** Per ADR-025, Playwright e2e now gates every PR merge. The
highest-fan-out logic in the app is validated only by slow browser tests —
a regression in `JobForm` surfaces minutes later in CI, not in a fast local
unit run.
**Fix:** Add component-level tests (RTL) for at least `JobForm` and
`KanbanBoard` — highest fan-out, highest change frequency.

### 🟡 `jobs-page` ↔ `dashboard-chart` coupling (auto-flagged)
**Where:** cross-community edge count 14 — highest in the graph.
**Problem:** Page component reaches directly into chart-rendering internals
instead of through a props/data boundary.
**Fix:** Define an explicit data-shape boundary (props interface) between the
page and the chart component; audit the 14 call edges for ones that should be
data, not calls.

### 🟡 Repeated fix-cycle on interview-round status sync
**Where:** ADR-017 (status sync design) → ADR-018 (race-condition fixes:
transactional writes, CAS promotion, CAS on manual status update), shipped
right after.
**Why it matters:** Not a live bug (ADR-018 resolved it), but a pattern —
first design missed a concurrency case and needed an immediate hardening
pass. Worth watching if notifications/enrichment get the same treatment.

### 🟡 e2e suite is itself a large, low-cohesion blast radius
**Where:** `e2e-go` community — 141 nodes, cohesion 0.18 (lowest of any
sizable community). Individual tests touch huge swaths of the graph:
`profile.spec.ts` test @L112 has total degree 95, `kanban.spec.ts` @L70 has 91.
**Why it matters:** A single flaky selector in a mega-test tells you almost
nothing about what actually broke.
**Fix:** No immediate action — noted as a maintainability cost of the
e2e-as-merge-gate strategy (ADR-025), not a bug.

### 🟡 DTO layer sprawl
**Where:** `dto-dto` community — 607 members, cohesion 0.25 (lowest of any
sizable community). `funnel-stats.dto.ts` alone defines 3 nested response
shapes.
**Why it matters:** One-DTO-per-shape convention (CLAUDE.md pattern) has
ballooned with nothing enforcing reuse — likely duplicate-shaped DTOs across
modules. Not wrong, but nothing surfaces it short of manual audit.

### 🟡 Custom "Enter a valid URL" message is unreachable for type-mismatched values
**Where:** `frontend/components/jobs/job-form.tsx` — `url: z.string().url('Enter
a valid URL').or(z.literal('')).optional()`, rendered via `<Input type="url" ...>`.
**Problem:** `<input type="url">` carries the browser's own HTML5 constraint
validation. For a value like `not-a-url` (fails the native URL-syntax check),
clicking the submit button never reaches React at all — the browser blocks
the `submit` event before RHF/Zod runs, so Zod's custom message never renders
for that class of input. Confirmed directly: `input.checkValidity()` returns
`false` and the form's `onSubmit` handler never fires; only a synthetic
`fireEvent.submit()` (bypassing native validation) reaches the Zod path.
Users instead see the browser's own native validation bubble ("Please enter
a URL.") — inconsistent styling/wording with the rest of the form's errors.
**Why it matters:** Not a functional bug (bad URLs are still blocked), but the
custom message is dead code for this input type in the one case it seems
written for. A future `noValidate` addition, or a differently-invalid-but-
native-passing value, would change this silently.
**Fix:** Either add `noValidate` to the `<form>` and let Zod own all
messaging (consistent styling, matches every other field), or drop
`type="url"` in favor of `type="text"` with the same Zod validation.

### 🟡 `main.ts::bootstrap` untested
**Where:** `backend/src/main.ts` — degree 33 (33rd-most-connected node in
backend), no test coverage.
**Why it matters:** Single point of startup failure with zero coverage. Fine
for a solo project; worth naming if asked how to productionize.

---

## If picking one to fix first

**Frontend unit-test gap** (untested-hotspots list above) — bigger day-to-day
cost than any single bug: e2e-gated merges mean every regression in the
highest-fan-out code takes a full browser-test cycle to surface instead of a
local unit run.
