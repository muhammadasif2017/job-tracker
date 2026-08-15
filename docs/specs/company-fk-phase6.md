# Spec: Company Autocomplete + Company Detail Page, Phase 6

Parent: [company-single-source-of-truth.md](../ideas/company-single-source-of-truth.md), phase 6 — separate additive UX, not a step of the core FK merge. Can ship in parallel with phase 5; only depends on phase 1 (FK exists).

## Objective

Two independent, additive UX pieces, each shippable alone:

1. **Autocomplete on job-create**: typing a company name suggests existing `Company` rows (reduces near-duplicate creation at the source — cheaper than phase 5's after-the-fact merge).
2. **Company detail page**: a per-company view listing every `Job` linked to it (currently the Companies section shows company data but not its associated jobs).

## Tech Stack
Next.js, existing TanStack Query hook conventions.

## Commands
Same as phase 1 (no schema change — pure query + UI).

## Project Structure
```
# Autocomplete (own PR)
backend/src/modules/companies/companies.controller.ts   → GET /companies/search?q= (if not already present)
frontend/components/jobs/job-form.tsx                    → autocomplete input
frontend/features/companies/hooks.ts                     → useCompanySearch

# Company detail page (own PR)
backend/src/modules/companies/companies.service.ts        → findOne includes jobs
frontend/app/(dashboard)/companies/[id]/page.tsx (new)
frontend/features/companies/hooks.ts                       → useCompany(id) with jobs
```
~3-4 files each, two separate PRs.

## Code Style
Autocomplete: debounce input, reuse the case-insensitive match style already in `jobs.service.ts`. Company detail: mirror job detail page's `include` pattern (`companyProfile`/`resume`/etc. at `jobs.service.ts:168-174`) but from `Company`'s side — `Company.findFirst({ include: { jobs: { orderBy: { createdAt: 'desc' } } } })`.

## Testing Strategy
Autocomplete: unit test search endpoint returns matches, component test for debounce/select behavior. Company detail: e2e — create 2 jobs at same company, visit company detail page, both listed.

## Boundaries
- Always: autocomplete must not block manual entry of a genuinely new company name (freeform input stays valid, suggestions are optional).
- Ask first: none — additive, no schema change, no destructive action.
- Never: let autocomplete auto-select a suggestion on blur without explicit user pick (silent wrong-match risk).

## Success Criteria
- [ ] Typing an existing company name on job-create shows it as a suggestion; selecting it doesn't change job-create behavior otherwise (still goes through phase 1's find-or-create)
- [ ] Company detail page lists all jobs for that company, links to each job's detail page
- [ ] Each PR ≤10 files (2 PRs total this phase)

## Open Questions
- Does `GET /companies/search` already exist (built for the target-companies feature)? Check before assuming it needs to be added — likely already present given `docs/specs/target-companies.md`.
- Company detail page scope: read-only job list, or also surface company-level edit form on the same page? Recommend read-only list + link to existing edit UI, keep this phase small.
