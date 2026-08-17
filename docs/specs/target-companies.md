# Spec: Target Companies

## Objective

Let the user build a list of companies they want to work for (Pakistan IT — Lahore/Islamabad/Karachi) independent of any job application, with personal priority/notes plus AI-researched company data, HR contact tracking, and a passive heads-up when they later apply to a company already on the list. Builds on `docs/ideas/target-companies.md` (soft-link MVP direction, already confirmed with the user).

Success: user can add a company manually or via CSV import, trigger AI enrichment on it, record HR contacts against it, browse/filter the list by city/priority, and see a dismissible "you already saved this company" banner when creating a `Job` whose company name matches.

## Company Fields — Scope

Curated to what actually changes an apply/skip decision, not everything scrapeable:

**Personal, always user-owned (AI never writes these):** `name`, `city` (enum), `location` (free text), `priority` (reuse `JobPriority`), `personalNotes`.

**AI-fillable, user-correctable (enrichment writes first, user can overwrite — see Assumption 9 for the refresh tradeoff):** `businessMode` (`PRODUCT`/`SERVICES`/`HYBRID` — the field most likely to need a manual fix), `productDescription`, `industry`, `techStack`, `companySize`, `founded`, `workPolicy`, `workLifeBalance`, `cultureSummary`, `headquarters`, `address` (+ existing `headquartersLowConfidence`/`addressLowConfidence` guard flags), `websiteUrl`, `linkedinUrl` (company LinkedIn page — lets the user cross-check the hiring posts this list is sourced from).

**Deliberately not storing** (no job-search decision value, or stale on arrival): revenue/financials (unreliable for private Pakistani companies), legal/registration/tax IDs, current open-position count (decays the moment it's saved — that's what the `Job` list already tracks), awards/certifications, social links beyond LinkedIn.

## Assumptions

1. `Company` is a new top-level model owned directly by `userId` (like `Job`), not nested under anything — it needs to exist with zero jobs.
2. Enrichment for `Company` is a **new, separate** pipeline (new queue/processor/columns) that reuses the existing `SearchService`, `WebFetchService`, and `LlmService` from `EnrichmentModule` as-is — it does **not** modify `EnrichmentProcessor` or the `CompanyProfile` model. That pipeline is dense, carefully threshold-tuned (see the guard-confidence comments in `enrichment.processor.ts`), and job-shaped throughout (`dbJob.company`/`dbJob.url`); generalizing it to also accept a bare `Company` is a materially riskier change than standing up a parallel copy that calls the same three injectable services. Correct me if you'd rather I attempt the shared-model approach instead.
3. `Company.priority` reuses the existing `JobPriority` enum (`LOW`/`MEDIUM`/`HIGH`) rather than a new `CompanyPriority` enum — same three values, no reason to duplicate.
4. "Total workplace count" from the idea doc maps to a free-text `companySize` field (e.g. `"50-200 employees"`), same shape as `CompanyProfile.companySize` — company headcount is usually reported as a range, not an exact int.
5. CSV import is a small **hand-rolled** parser (split on `,`/newline, no quoted-field/embedded-comma support) for a fixed column set (`name,city,businessMode`) — matches the existing hand-rolled CSV *export* in `jobs-stats.service.ts` (no CSV library in `package.json` today) and the CLAUDE.md rule against adding a dependency without checking necessity. If real-world exports (e.g. from a LinkedIn search) turn out to need quoted-comma handling, escalate to adding `csv-parse` rather than hand-rolling that edge case.
8. `businessMode` (`PRODUCT`/`SERVICES`/`HYBRID`) and `productDescription` (free text — what they build or offer) replace the earlier vague `businessType` placeholder. `founded` (year established) was already in scope via Assumption 2's enrichment-shape columns — it's user-editable on `Company` too, not enrichment-only, same as every other field the AI can also fill in.
6. Auto-flag matching is exact-or-case-insensitive name match only (`Company.name` vs `Job.company`, `mode: 'insensitive'`) — no fuzzy/Levenshtein matching in v1. A "Systems Ltd" vs "Systems Limited" miss is acceptable; over-matching (false positive) is worse than under-matching here.
7. `Contact.jobId` and `Contact.companyId` both become nullable, exactly one required — enforced in `ContactsService`, not a DB-level `CHECK` constraint (Prisma has no first-class support for that without a raw-SQL migration edit).
9. AI-fillable fields (see Company Fields — Scope) are fully user-editable via `PATCH /companies/:id` — same `T | null` DTO pattern as everywhere else. Clicking "Refresh enrichment" always overwrites them with the new AI result, same all-or-nothing semantics `CompanyProfile` already has for `Job` — no per-field provenance tracking (AI vs. manually-corrected) is being added, that's real complexity for a solo-user list. Mitigation is frontend-only: a confirm dialog before refresh warning that manual corrections will be replaced. Revisit only if this turns out to bite in practice.

## Tech Stack

Existing stack, no new dependencies: NestJS + Prisma 7 + PostgreSQL + BullMQ/Redis (backend), Next.js 16 + TanStack Query + RHF/Zod (frontend). Reuses Groq (`openai/gpt-oss-120b`) + Tavily already wired for job enrichment.

## Commands

```
Backend migrate:  npx prisma migrate dev --name add_target_companies   (run from backend/, requires user OK per CLAUDE.md — touches shared dev DB)
Backend generate: npx prisma generate
Backend test:     npm run test:e2e            (backend/)
Backend types:    npx tsc --noEmit             (backend/)
Frontend test:    npm test                     (frontend/)
Frontend build:   npm run build                (frontend/, per CLAUDE.md — catches prop-type mismatches tsc misses)
Frontend lint:    npm run lint
```

## Project Structure (files touched)

```
backend/prisma/schema.prisma
  → new enum CompanyCity { LAHORE, ISLAMABAD, KARACHI, OTHER }
  → new enum BusinessMode { PRODUCT, SERVICES, HYBRID }
  → new model Company (owned by userId; businessMode + productDescription (user-editable);
     own EnrichmentStatus/industry/companySize/techStack/cultureSummary/workPolicy/headquarters/
     address/founded/errorMessage/enrichedAt columns, mirroring CompanyProfile's shape but on
     its own table — see Assumption 2)
  → Contact: jobId String → String?, add companyId String? + relation, both indexed

backend/src/modules/companies/                      → new module, same shape as contacts/jobs
  companies.module.ts
  companies.controller.ts                            → CRUD + POST /companies/import (CSV) + POST /companies/:id/enrichment
  companies.service.ts                                → ensureCompanyOwned(userId, companyId) pattern, mirrors ensureJobOwned
  companies-import.service.ts                         → hand-rolled CSV parsing (Assumption 5)
  dto/create-company.dto.ts, update-company.dto.ts, company-response.dto.ts

backend/src/modules/companies/enrichment/            → new, parallel to modules/enrichment/ (Assumption 2)
  company-enrichment.module.ts
  company-enrichment.service.ts                       → enqueueEnrichment(companyId), same upsert-then-queue.add shape as EnrichmentService
  company-enrichment.processor.ts                     → new BullMQ queue 'company-target-enrichment'; injects
                                                          SearchService/WebFetchService/LlmService from EnrichmentModule
                                                          (EnrichmentModule needs to export these three providers)

backend/src/modules/enrichment/enrichment.module.ts   → add SearchService, WebFetchService, LlmService to `exports`

backend/src/modules/contacts/contacts.service.ts      → ensureJobOwned → ensureOwner(userId, {jobId?, companyId?}),
                                                          same dual-branch pattern on all 4 methods
backend/src/modules/contacts/dto/create-contact.dto.ts → companyId?: string (mutually exclusive with jobId, validated in service)

backend/src/modules/jobs/jobs.service.ts               → create(): after insert, look up Company by case-insensitive
                                                          name match, return { ...job, matchedCompany } (not persisted)

backend/src/app.module.ts                              → register CompaniesModule, CompanyEnrichmentModule

frontend/types/index.ts                                 → Company, CompanyCity, CSV import response types;
                                                          CITY_LABELS/CITY_COLORS following STATUS_LABELS/STATUS_COLORS pattern
frontend/features/companies/hooks.ts                     → useCompaniesQuery, useCreateCompanyMutation, useCompanyEnrichmentMutation, etc.
                                                          — mirrors frontend/features/jobs/hooks.ts query-key/invalidation pattern
frontend/app/(dashboard)/companies/page.tsx              → new route, new sidebar entry (components/layout/sidebar.tsx)
frontend/components/companies/company-form.tsx           → RHF + Zod, mirrors job-form.tsx
frontend/components/companies/company-list.tsx           → browse/filter by city/priority
frontend/components/jobs/job-form.tsx                    → dismissible "already saved" banner using matchedCompany from create response
```

## Code Style

Backend module shape — copy `backend/src/modules/contacts/` structure exactly (controller + service + `dto/` folder, one DTO per shape). Ownership check pattern, generalized for the dual-FK `Contact`:

```ts
private async ensureOwner(userId: string, ref: { jobId?: string; companyId?: string }) {
  if (ref.jobId) {
    const job = await this.prisma.job.findFirst({ where: { id: ref.jobId, userId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
    return;
  }
  const company = await this.prisma.company.findFirst({ where: { id: ref.companyId, userId }, select: { id: true } });
  if (!company) throw new NotFoundException('Company not found');
}
```

DTO nullability — optional fields that must support explicit clearing use `T | null`, never bare `T | undefined` (see project CLAUDE.md, ADR-022):

```ts
@ApiPropertyOptional({ enum: BusinessMode, example: 'SERVICES' })
@IsOptional()
@IsEnum(BusinessMode)
businessMode?: BusinessMode | null;

@ApiPropertyOptional({ example: 'IT staff augmentation for US clients', maxLength: 500 })
@IsOptional()
@IsString()
@MaxLength(500)
productDescription?: string | null;
```

All backend imports use `.js` extensions (ESM convention, see backend/CLAUDE.md) even though files are `.ts`.

Frontend hook — mirror the existing `Jobs` query-key/invalidation convention:

```ts
export function useCompaniesQuery(filters: CompaniesFilters) {
  return useQuery<PaginatedCompanies>({
    queryKey: ['companies', filters],
    queryFn: () => api.get(`/companies?${params}`).then((r) => r.data),
  });
}
```

## Testing Strategy

- Backend: new `companies.service.spec.ts` (unit) covering CRUD + ownership rejection, `ensureOwner` both branches — same style as `contacts.service.ts` tests.
- Backend: `company-enrichment.processor.spec.ts` covering the happy path and a failed-search path — reuse test doubles for `SearchService`/`WebFetchService`/`LlmService` already built for `enrichment.processor.spec.ts` (do not need new mocks, just point them at `Company` instead of `Job`).
- Backend: extend `test/app.e2e-spec.ts` with company create/list/delete + a name-match-on-job-create case.
- Backend: CSV import unit tests — valid file, malformed row, empty file, duplicate name row.
- Frontend: `company-form.test.tsx`, `company-list.test.tsx` — Vitest, mirror `job-form.test.tsx` conventions.
- No new Playwright e2e spec required for v1 unless the human wants one — this is a lower-traffic surface than job CRUD; existing `e2e-pr.yml` gate still runs whatever specs exist.

## Boundaries

- **Always:** run `prisma generate` after the migration; run backend `test:e2e` and frontend `npm run build` before calling done (per both CLAUDE.md files); keep `EnrichmentProcessor`/`CompanyProfile` untouched per Assumption 2.
- **Ask first:** the `prisma migrate dev` itself (shared dev DB); adding `csv-parse` if the hand-rolled parser proves insufficient (Assumption 5); whether to also add `Job.companyId` (out of scope per the idea doc — soft-link only, hard-link is a v2 decision).
- **Never:** duplicate `SearchService`/`WebFetchService`/`LlmService` logic instead of importing them from `EnrichmentModule`; add LinkedIn scraping or a scraping-capable browser-extension permission (explicitly rejected in the idea doc); persist a copy of `Company` contacts/notes onto `Job` (cross-reference only, per the settled open question).

## Success Criteria

- [ ] `POST /companies` creates a company scoped to the authenticated user; `GET /companies` lists/filters by city and priority.
- [ ] `POST /companies/:id/enrichment` enqueues the new company-target queue and eventually populates industry/techStack/culture/etc. on the `Company` row, without touching any `Job` or `CompanyProfile` row.
- [ ] `POST /companies/import` accepts a CSV (`name,city,businessMode`) and creates one `Company` row per valid line, reporting per-row errors for malformed lines.
- [ ] `POST /jobs` response includes `matchedCompany` (or `null`) when the submitted `company` string case-insensitively matches an existing `Company.name` for that user; frontend renders a dismissible banner, no blocking behavior.
- [ ] `Contact` can be created against either a `Job` or a `Company` (never both, never neither) — validated server-side, 400 on violation.
- [ ] All new/changed backend routes are behind the existing global `JwtAuthGuard`, ownership-checked the same way `Job`/`Contact` already are.
- [ ] `npm run test:e2e` (backend) and `npm run build` (frontend) both pass.

## Open Questions

None outstanding — all three from the idea doc (`docs/ideas/target-companies.md`) are settled and reflected above (city enum + free-text, passive banner, cross-reference not copy). Assumption 2 (parallel enrichment pipeline vs. generalizing the existing one) is the one design call in this spec not previously discussed with the user — flagged above, needs explicit sign-off before implementation starts.
