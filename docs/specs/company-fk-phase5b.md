# Spec: Field-by-Field Conflict Picker, Phase 5b

Parent: [company-fk-phase5.md](company-fk-phase5.md), second of three sub-phases. Depends on 5a (core merge, shipped — `POST /companies/:id/merge`, `MergeCompanyDialog`).

## Objective

When the canonical and duplicate companies have differing values for the same enrichment field, let the user pick which value survives the merge, per field — instead of 5a's current behavior (canonical's own fields always win, unconditionally).

Success: merging two companies with differing `industry`/`techStack`/etc. shows a per-field picker before the final confirm step; picking a value applies it to the canonical company as part of the same merge transaction. Two companies with no field differences skip the picker entirely — no extra step for the common case.

## Scope: which fields get the picker

The AI-enrichment field set only — the same fields `CompanyEnrichmentProcessor` writes: `industry`, `companySize`, `techStack`, `cultureSummary`, `workPolicy`, `workLifeBalance`, `headquarters`, `headquartersLowConfidence`, `address`, `addressLowConfidence`, `founded`. **Not** user-editable identity fields (`websiteUrl`, `linkedinUrl`, `personalNotes`, `businessMode`, `productDescription`, `priority`, `city`, `location`) — those stay canonical-wins unconditionally, same as 5a, since they're user-curated rather than AI-extracted and a conflict there is a deliberate user choice already made when each company was created/edited, not an "which AI run was right" question.

`techStack` (an array) needs its own comparison rule — treat differing as "sets differ" (not deep-equal order-sensitive), and the picker offers "canonical's list" vs "duplicate's list" wholesale (not a per-item merge — that's real added complexity for a rare case, not worth it for MVP).

## Tech Stack
Same as 5a — no new backend endpoint. Extends the existing merge endpoint's request body.

## Design: no extra round-trip needed

`GET /companies?search=...` (already used by `MergeCompanyDialog`'s search step) already returns full `Company` objects, not just `{id, name}`. The frontend already has both companies' complete field data in memory once the user picks a duplicate from search results — the diff can be computed **client-side**, no new "preview" endpoint required. If any in-scope field differs, show the picker before the existing confirm step; if none differ, go straight to confirm (5a's current behavior, unchanged).

## Project Structure
```
backend/src/modules/companies/dto/merge-company.dto.ts   → add optional fieldOverrides
backend/src/modules/companies/companies.service.ts        → mergeCompanies applies fieldOverrides to canonical inside the transaction
backend/src/modules/companies/companies.service.spec.ts   → unit tests for overrides
frontend/components/companies/merge-company-dialog.tsx    → diff computation + per-field picker step
frontend/components/companies/merge-company-dialog.test.tsx → picker tests
frontend/features/companies/hooks.ts                       → useMergeCompaniesMutation takes fieldOverrides
```
~3 backend files, ~3 frontend files — one PR each, same split as 5a (backend endpoint change first, frontend UI second), or bundle into one PR since the change is small on both sides — decide at planning time based on actual diff size.

## Code Style

DTO addition:
```ts
export class MergeCompanyDto {
  @IsString() @IsNotEmpty()
  duplicateCompanyId: string;

  @IsOptional() @IsObject()
  fieldOverrides?: Partial<Pick<Company,
    'industry' | 'companySize' | 'techStack' | 'cultureSummary' |
    'workPolicy' | 'workLifeBalance' | 'headquarters' | 'headquartersLowConfidence' |
    'address' | 'addressLowConfidence' | 'founded'
  >>;
}
```

Service: after the existing ownership checks, before `job.updateMany`, apply `fieldOverrides` (if present) to canonical via `tx.company.update`. Only fields the user actually picked get touched — an absent key means "keep canonical's current value" (already true, no write needed), not "clear the field."

## Testing Strategy
- Unit: merge with `fieldOverrides` updates only the specified fields on canonical, leaves the rest untouched. No `fieldOverrides` → identical behavior to 5a (regression test, must still pass).
- Frontend: two companies with identical enrichment fields → picker step skipped, straight to confirm (existing 5a test must still pass unmodified). Two companies with a differing `industry` → picker shown, both values visible, selecting duplicate's value includes it in the mutation payload.
- E2e: real merge with a field conflict, verify the picked value lands on the canonical company after merge (`GET /companies/:id`).

## Boundaries
- Always: fields not in the AI-enrichment scope list stay canonical-wins, no picker for them, ever (see Scope).
- Ask first: none beyond normal PR review — no schema/migration.
- Never: silently pick a "winner" when fields differ and no explicit `fieldOverrides` entry covers that field — canonical's existing value stays as-is (the safe, already-true default), it does NOT throw or block the merge. The picker is there to let the user *override* if they want to, not to force a decision on every field.

## Success Criteria
- [ ] Picker only appears when at least one in-scope field actually differs
- [ ] Picking a value updates canonical's field as part of the merge transaction
- [ ] No-conflict merges are unaffected (5a's existing tests keep passing)
- [ ] Each PR ≤10 files

## Open Questions
None — resolved as recommended: `techStack` is normalized (sorted, deduped) before diffing, so reordering alone doesn't trigger the picker for an otherwise-identical list.
