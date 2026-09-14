# Spec: Company Reply History

## Objective

Most companies in the Pakistan job market never reply (see
`docs/specs/response-insights.md`). The app records every application per
company, but it never shows that history where decisions get made:

- The company page lists the jobs, but not how they went: how many got a reply,
  how many went silent, or when you last applied.
- The companies list gives no way to spot companies that never reply.
- Adding a job for a company you already applied to gives no signal at all. So
  you can re-apply to a company that ghosted you last month without noticing.

**User stories:**
- On a company's page, I see how many jobs I applied for there, how many got a
  reply, how many were ghosted or look ghosted, the reply rate, and when I last
  applied.
- In the companies list, I see the application count and reply rate for each
  company.
- When I create a job (job form or Quick Add) for a company that already has
  jobs, I get a confirm step that shows the history. I can add the job anyway
  or cancel.

**Out of scope:** sorting or filtering the companies list by reply rate, fuzzy
company-name matching, warnings on job edit, email.

## Assumptions

1. **No schema change and no migration.** Every number comes from existing
   `Job` and `JobEvent` rows.
2. **Stats key on `Job.companyId` only.** Phase 3 of the company FK work
   backfilled `companyId`, and `resolveCompanyId` sets it for every job with a
   non-empty company name. The local dev DB has 0 jobs with a null `companyId`.
3. **The warning looks up by company name** (case-insensitive exact match, same
   rule as `resolveCompanyId`). The create forms only have a company name until
   the job is saved.
4. **Warn on any existing job for that company,** including `WISHLIST`. The
   stats exclude `WISHLIST` jobs.
5. **The confirm step is inline in the existing modal** (job form and Quick Add
   are already modals). It replaces the submit buttons. No nested modal.

## Definitions

All stats cover one company and exclude `WISHLIST` jobs.

- **Applied:** count of the company's jobs with status other than `WISHLIST`.
- **Replied:** jobs that match `REPLIED_FILTER` (`jobs.constants.ts`). Import
  the constant, do not copy it. This is the same "ever replied" rule the
  dashboard uses.
- **Ghosted:** jobs with status `GHOSTED`, plus jobs that look ghosted. A job
  looks ghosted when:
  - its status is `APPLIED` or `INTERVIEWING`, and
  - `appliedAt` is before the 14-day cutoff, and
  - it has no event after the cutoff, and
  - it has no future `nextInterviewAt`.

  This predicate ignores `ghostSuggestionDismissedAt`. A dismissal means "stop
  suggesting this", not "the company replied". Extract the predicate from
  `buildGhostSuggestionWhere` as `buildSilentJobWhere`.
  `buildGhostSuggestionWhere` then adds the dismissal clause on top, so both
  share one cutoff and cannot drift apart.
- **Replied and Ghosted can overlap.** A job that reached `INTERVIEWING` and
  then went silent counts in both. The UI labels them separately, not as parts
  of one total.
- **Reply rate:** `toPercent(replied, applied)`.
- **Last applied:** latest `appliedAt` among non-`WISHLIST` jobs, or `null`.

## API

Shared shape `CompanyApplicationStatsDto`:
`{ applied, replied, ghosted, replyRate, lastAppliedAt: string | null }`.

- `GET /companies/:id` adds `applicationStats: CompanyApplicationStatsDto`.
- `GET /companies` adds `applicationStats` to each row. Compute it for the
  current page's company ids only: one grouped query for each count, not one
  query per company.
- **New:** `GET /companies/application-history?name=<company name>` returns:
  - `company`: `{ id, name }`, or `null` if no company has that name;
  - `stats`: `CompanyApplicationStatsDto`, or `null`;
  - `recentJobs`: up to 3 of the company's jobs, newest `appliedAt` first,
    each `{ id, position, status, appliedAt }`.

  An empty or whitespace name returns `company: null`. Declare this route
  above `@Get(':id')`, like `@Get('duplicates')`.

## UI

- **Company detail page:** a stats strip above "Jobs at this company":
  - Applied, Replied, Ghosted, Reply rate, Last applied;
  - "No applications yet" when Applied is 0.
- **Companies list:** each row shows `N applied · X% replied`. Rows with 0
  applied show nothing extra.
- **Create confirm:** one shared hook (`useCompanyHistoryCheck`) and one shared
  component (`CompanyHistoryConfirm`), used by `job-form.tsx` (create only,
  never edit) and `quick-add.tsx`.
  - On submit, fetch history for the entered company name.
  - If `recentJobs` is empty, save straight away.
  - Otherwise show: "You applied to <Company> N times, last on <date>.
    X replied, Y ghosted."
  - Below that, list up to 3 recent jobs (position, status badge, date), then
    **Add anyway** and **Cancel**.
  - If the history fetch fails, save anyway. The check is advisory and must
    never block creating a job.

## Commands

- Backend: `npm test`, `npm run test:e2e`, `npm run lint`.
- Frontend: `npm test`, `npm run build`, `npm run lint`, `npx playwright test`.
- Root: `npm run check:floor`.

## Testing Strategy

- Unit tests for the stats helper:
  - `WISHLIST` excluded;
  - a job that replied then went silent counts in both Replied and Ghosted;
  - a dismissed silent job still counts as Ghosted;
  - a future interview does not count as Ghosted.
- `buildGhostSuggestionWhere` keeps its existing tests unchanged, which proves
  the refactor did not change it.
- Backend e2e: the three endpoints, including a case-insensitive name match,
  an unknown name, and another user's company (not visible).
- Frontend unit tests: stats strip, list row, confirm shown or skipped, and a
  failed history fetch still saves.
- Playwright: create a job for an existing company and see the confirm.
- Coverage-diff must be at least 80%.

## Boundaries

- Always: reuse `REPLIED_FILTER` and the shared cutoff.
- Always: scope every query by `userId`.
- Ask first: any schema change, and sorting the list by reply rate.
- Never: block job creation on the history check, or change
  `buildGhostSuggestionWhere` behavior.

## Success Criteria

- The company page and list show stats that match the definitions above.
- The dashboard and the company page count "replied" the same way.
- Creating a job for a company with existing jobs shows the confirm, in both
  the job form and Quick Add.
- Creating a job for a new company shows no confirm.
- All CI gates pass. No migration.
