# ADR-029: Company/job FK integrity fixes, merge race, CSV import cap, and shared enrichment card

## Status
Accepted

## Date
2026-08-17

## Context

Four related defects and one refactor surfaced while working the company
single-source-of-truth migration (`docs/specs/company-fk-phase*.md`) further
than phase 6:

### 1. `Job.companyId` drift on edit
`JobsService.create` resolved `dto.company` (the free-text label) to a real
`Company` row via find-or-create, populating `Job.companyId`. `JobsService.update`
never did the equivalent: editing a job's company name field only rewrote the
`Job.company` label column, leaving `companyId` pointed at whatever company the
job was originally linked to (or `null`). `Job.company` and `Job.companyId` — the
two columns every enrichment/merge/company-detail-jobs-list feature reads —
could silently disagree after a single edit.

### 2. Company merge race
`CompaniesService.merge` read `canonical`/`duplicate` via `findFirst` inside a
transaction, then reassigned `Job`/`Contact` rows and deleted `duplicate` —
all under the default (Read Committed) isolation level. Two concurrent merge
requests naming the same `duplicateId` (double-click, two tabs) would both
pass the existence check before either wrote, then both attempt to reassign
and delete the same row.

### 3. CSV import cap bypass and BOM handling
`CompaniesService.create` had no ceiling on companies-per-user, and
`findDuplicateSuggestions`'s pairwise scan is intentionally O(n²) at this
app's scale (`docs/specs/company-fk-phase5c.md`) — an unbounded company list
makes that scan arbitrarily expensive. Separately, `CompaniesImportService`
writes rows directly via its own batch insert, bypassing
`CompaniesService.create` entirely, so any cap added only there would not
apply to CSV import. Excel/Google Sheets CSV exports also commonly prepend a
UTF-8 BOM (U+FEFF), which was landing inside the first header cell and
failing header validation on an otherwise-valid file.

### 4. Duplicated enrichment-field rendering
`frontend/components/company-profile-card.tsx` rendered a `CompanyProfile`
(job-linked enrichment record) for the job-detail page. The company-detail
page hand-rolled a second copy of the same field list (industry, size,
founded, headquarters, tech stack, culture, work policy) directly in
`companies/[id]/page.tsx` against the `Company` type instead of reusing the
component — any future enrichment field would need updating in two places to
stay visually consistent.

## Decision

### 1. Shared `resolveCompanyId` helper, called from both create and update
Extracted the find-or-create logic (case-insensitive exact match,
`CompanyCity.OTHER` for auto-created rows, never overwrites an existing
company's fields) into `JobsService.resolveCompanyId`, run inside a
`Serializable` transaction with a re-fetch fallback on `P2034`/`P2002` — the same
race-closing pattern as `CompaniesService.runNameCheckedWrite` — so two
concurrent create/update calls racing a case-variant company name ("Google"
vs "google") can't create two companies for the same user. `update` now
calls it whenever the caller actually sends `dto.company`, setting
`companyId` to the resolved id alongside the existing label write. An
explicit `company: null` is rejected with a 400 rather than treated as
"unlink" — `Job.company` is a required non-nullable column, so unlike this
repo's usual `T | null`-clears-the-field convention for optional profile
fields, there is no unlinked state to clear it into; `class-validator`'s
`IsOptional()` (added by `PartialType` on the update DTO) lets `null` past
validation, so the service layer must reject it explicitly. `Job.company`
deliberately still does **not** get retroactively rewritten if the linked
`Company` is later renamed or merged elsewhere — only an explicit edit of
*this job's* company field re-resolves the FK. `JobResponseDto.companyProfile`
now documents that only `findOne`'s reshaped response populates it; the raw
`PATCH` result doesn't include it, and frontend mutations consuming the PATCH response
already account for this (`usePatchJobStatusMutation` re-grafts the previous
`companyProfile` rather than trusting the response).

### 2. Serializable transaction on merge, mapped to 409
`merge` now runs its transaction at `Serializable` isolation — the same
level `runNameCheckedWrite` already uses elsewhere in this service — so
Postgres aborts the losing concurrent transaction with a write-conflict
error instead of letting both proceed. The catch block maps that conflict to
a `ConflictException` ("This company is being merged concurrently — refresh
and try again"); any other error rethrows unchanged. All four of this
service's Serializable-transaction catch blocks (here, `runNameCheckedWrite`,
`CompaniesImportService.runImportTransaction`, and `JobsService.resolveCompanyId`)
share `isTransactionWriteConflict` (`src/common/prisma-errors.ts`) instead of
each checking `err.code === 'P2034'` independently — a conflict Postgres only
detects at COMMIT time (the common case for the §3 count check below)
surfaces as a differently-shaped, unwrapped `DriverAdapterError` that a bare
`P2034` check misses entirely, discovered via a real two-writer e2e test
against live Postgres (`test/app.e2e-spec.ts`); see `backend/CLAUDE.md`
"Prisma 7 Quirks" for the full mechanism.

### 3. `MAX_COMPANIES_PER_USER = 2000` enforced independently in both write
paths, plus cost-scaled throttles and BOM stripping
`CompaniesService.create` counts existing rows *inside* the same `Serializable`
transaction as the name-uniqueness check and the insert (closing the same
class of TOCTOU race fixed in §1/§2 — an earlier version of this fix counted
outside the transaction, letting concurrent creates both pass the check at
the 1999/2000 boundary). `CompaniesImportService` re-declares the same
constant and tracks a running `projectedCount` across the batch inside its
own `Serializable` transaction (since it writes directly and never calls
`create`) — the two constants must be kept in sync by hand; there is no
shared source of truth for the value. `POST /companies/import` gets
`@Throttle({ ttl: 60000, limit: 10 })`, separate from the global 100/min
default, matching the existing pattern for `POST /jobs/parse` (`backend/
CLAUDE.md` "Rate Limiting") — a bulk CSV write is far costlier per call than
a typical CRUD request. `GET /companies/duplicates` deliberately does **not**
get a route-specific throttle: it's fetched passively on every companies-page
mount, and a 10/min cap broke ordinary navigation (E2E flakiness) rather than
just blocking abuse — `MAX_COMPANIES_PER_USER` already bounds its O(n²)
worst-case cost, so the generic 100/min guard is enough. CSV import strips a
leading BOM by comparing `charCodeAt(0) === 0xfeff` (not a regex literal, so
the BOM character itself never appears in source) before header parsing.

### 4. Shared `CompanyProfileCard`, generalized over `Company | CompanyProfile`
`company-profile-card.tsx` now accepts `EnrichmentFieldsSource = CompanyProfile
| Company` and an explicit `invalidateKey: QueryKey` prop (`['job', jobId]` on
the job-detail page, `['company', id]` on the company-detail page) instead of
a hardcoded `jobId`. The company-detail page's hand-rolled field block (~70
lines) was deleted in favor of `<CompanyProfileCard profile={company} ... />`.
This works today because `CompanyProfile` and `Company` share the exact same
enrichment-field subset (`status`, `industry`, `companySize`, `techStack`,
`cultureSummary`, `workPolicy`, `workLifeBalance`, `headquarters`,
`headquartersLowConfidence`, `address`, `addressLowConfidence`, `founded`,
`errorMessage`, `enrichedAt`) — TypeScript's union property-access rule means
`ProfileFields` can only read fields present (with compatible types) on
*both* members, so this isn't a coincidence that can silently drift: adding
or renaming an enrichment field on one type without the other breaks the
build at every access site in `ProfileFields`, forcing the two definitions to
move together.

## Alternatives Considered

### 1. FK drift — validate/reject a company-name edit that doesn't match the
existing `companyId`'s name, instead of silently re-resolving
- Rejected: `Job.company` is explicitly the free-text label as typed at link
  time, not a mirror of the current `Company.name` (see the existing
  "doesn't get retroactively rewritten" rule). Rejecting a legitimate rename
  would contradict that design; re-resolving is the correct behavior for an
  explicit edit, which is what `create` already does for a brand-new job.

### 2. Merge race — optimistic locking (version column) or `SELECT ... FOR
UPDATE` on the two company rows
- Rejected: both require new schema (a version column) or manual lock
  ordering to avoid a deadlock between two merges that reference each other
  in opposite canonical/duplicate order. `Serializable` gets the same
  correctness guarantee from Postgres's existing conflict detection, and
  matches the isolation level `runNameCheckedWrite` already uses for
  name-uniqueness — no new locking pattern to reason about.

### 3. CSV cap — index/paginate `findDuplicateSuggestions`'s O(n²) scan
instead of capping company count
- Rejected: out of scope per `docs/specs/company-fk-phase5c.md`, which
  already treats the O(n²) scan as intentional at this app's (single-user,
  personal-target-list) scale. A hard cap is simpler than restructuring the
  duplicate-detection algorithm for a problem that doesn't exist yet.

### 3b. CSV cap — move duplicate detection to a background job instead of a
synchronous request-scoped scan
- Rejected: same reasoning — disproportionate infrastructure (a new queue
  consumer, polling/notification for completion) for a scan that's cheap
  once bounded by `MAX_COMPANIES_PER_USER`.

### 4. Enrichment card — keep two separate rendering implementations, add a
shared constants file for field labels only
- Rejected: field labels were never the source of drift risk — the JSX
  layout (grid columns, conditional `UnverifiedBadge`, tech-stack chip
  rendering) was duplicated too, and a shared component removes all of it,
  not just the label strings.

## Consequences

- `Job.company` (label) and `Job.companyId` (FK) can no longer drift apart
  through the normal edit path; they can still legitimately point at
  different-looking data if the linked `Company` is renamed or merged
  independently afterward — that is by design, not a bug.
- A concurrent double-merge now surfaces as a `409` the losing caller's UI
  must handle (refresh and retry), not a possible partial/duplicate write.
- `MAX_COMPANIES_PER_USER` lives in two files (`companies.service.ts`,
  `companies-import.service.ts`) with no shared import between them —
  changing the cap requires remembering to update both; a future refactor
  could extract a shared constant, but wasn't required to fix the bypass.
- CSV imports are safe to run against real Excel/Sheets exports without a
  manual BOM-stripping step first.
- `frontend/components/company-profile-card.tsx` is now used by both
  job-detail and company-detail pages; a future enrichment field must be
  added to `ProfileFields` once, and to both the `CompanyProfile` and
  `Company` frontend types for the union access to typecheck — the compiler
  enforces the second part.
- `backend/scripts/backfill-company-fk.ts` was split into a thin CLI entry
  point plus `backfill-company-fk.core.ts` (unit-tested in
  `backfill-company-fk.spec.ts`); no behavior change, done to make the
  find-or-create-with-race-retry logic it duplicates from `resolveCompanyId`
  testable without a live database.
