# Spec: Auto-Suggest Near-Duplicate Detection, Phase 5c

Parent: [company-fk-phase5.md](company-fk-phase5.md), third and last of three sub-phases. Depends on 5a (core merge) and 5b (conflict picker), both shipped.

## Objective

Surface likely-duplicate company pairs to the user proactively, instead of requiring them to notice and search manually (5a/5b's flow). Clicking a suggestion opens the same merge dialog already built in 5a/5b, pre-seeded with both companies — skipping the search step, landing straight on the conflict picker (or confirm, if no fields differ).

Success: a user with two companies named "Systems Limited" and "systems ltd." sees a suggestion without having typed anything; dismissing or merging removes it from the list.

## Decision: matching rule and implementation

**In-app fuzzy match, no Postgres extension.** Considered `pg_trgm` (Postgres trigram similarity, would need `CREATE EXTENSION pg_trgm` + a migration) vs. computing similarity in application code. Chose in-app: this app's per-user company count is small (dozens, not thousands — a solo/personal job-tracking tool, not a CRM at scale), so an O(n²) pairwise comparison in JS after fetching one user's companies is cheap and avoids any schema/extension risk on Neon (extension allowlists and migration coordination are unnecessary complexity for this data volume). Revisit only if per-user company counts grow into the hundreds+.

Two independent match signals, either one flags a pair as a suggestion:
1. **`websiteUrl` exact match** (normalized: lowercase, strip `http(s)://`, strip leading `www.`, strip trailing `/`) — strongest signal, two companies can't legitimately share a real website.
2. **Fuzzy name match** — normalize (lowercase, strip punctuation, strip common suffixes: "inc", "llc", "ltd", "limited", "corp", "corporation", "co"), then Levenshtein distance ratio ≥ 0.85. Hand-rolled Levenshtein (~15 lines, no new dependency — per CLAUDE.md, don't add a dependency without checking necessity first, and this is trivial to implement in-house).

## Tech Stack
NestJS (new read-only endpoint, no schema change), Next.js (banner + reuse of existing `MergeCompanyDialog`).

## Commands
Same as phase 1. No migration this phase.

## Project Structure
```
backend/src/modules/companies/companies.controller.ts        → GET /companies/duplicates
backend/src/modules/companies/companies.service.ts             → findDuplicateSuggestions
backend/src/modules/companies/companies.service.spec.ts        → unit tests
backend/src/lib/levenshtein.ts (new)                            → hand-rolled similarity ratio, shared/testable in isolation
backend/src/lib/levenshtein.spec.ts (new)
frontend/features/companies/hooks.ts                            → useDuplicateSuggestionsQuery
frontend/components/companies/duplicate-suggestions-banner.tsx (new) → list of suggestion pairs, "Review" opens MergeCompanyDialog pre-seeded
frontend/components/companies/merge-company-dialog.tsx           → accept an optional pre-seeded duplicate, skip the search step when provided
frontend/app/(dashboard)/companies/page.tsx                      → render the banner
```
~4-5 backend files, ~4 frontend files — split into 2 PRs (backend detection endpoint, frontend banner + dialog pre-seed), same pattern as 5a/5b.

## Code Style

Detection is a plain service method, not a background job or cached table — computed fresh on each request against the current user's companies only:

```ts
async findDuplicateSuggestions(userId: string) {
  const companies = await this.prisma.company.findMany({
    where: { userId },
    select: { id: true, name: true, websiteUrl: true },
  });
  const suggestions: { a: Company; b: Company; reason: 'website' | 'name' }[] = [];
  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const [a, b] = [companies[i], companies[j]];
      if (a.websiteUrl && normalizeUrl(a.websiteUrl) === normalizeUrl(b.websiteUrl ?? '')) {
        suggestions.push({ a, b, reason: 'website' });
      } else if (similarity(normalizeName(a.name), normalizeName(b.name)) >= 0.85) {
        suggestions.push({ a, b, reason: 'name' });
      }
    }
  }
  return suggestions;
}
```

`MergeCompanyDialog` gets a new optional prop (e.g. `preSeedDuplicate?: Company`) — when set, the dialog opens directly at the `conflicts`/`confirm` step (reusing 5b's existing diff logic unchanged) instead of `search`.

## Testing Strategy
- Unit: `levenshtein.spec.ts` — known distance/ratio pairs, including the exact "Systems Limited" vs "systems ltd." case that motivated this phase. `companies.service.spec.ts` — websiteUrl match takes priority over name match when both would fire; below-threshold names don't suggest; a company only compared against others in the same user's list (no cross-user leakage).
- E2e: two companies with matching `websiteUrl` (different names) → suggestion appears; clicking Review opens the dialog pre-seeded, confirm-only (no conflicts) or picker (if fields differ) as appropriate.
- Frontend: banner shows suggestion count, dismissing a specific pair hides it for the session (client-side only — no "dismissed" persistence this phase, see Open Questions).

## Boundaries
- Always: detection is user-scoped (never compares across different users' companies) — the query already filters by `userId`, but assert this explicitly in a test, same discipline as 5a's cross-user merge check.
- Ask first: none — read-only endpoint, no migration, no destructive action (the merge itself still goes through 5a/5b's existing confirm step).
- Never: auto-merge a suggested pair without the user going through the full existing confirm flow — this phase only surfaces suggestions, it doesn't change what happens once the user acts on one.

## Success Criteria
- [ ] `GET /companies/duplicates` returns pairs scoped to the requesting user only
- [ ] websiteUrl match and fuzzy name match both detected, with a machine-readable `reason` per pair
- [ ] Clicking a suggestion's Review action opens `MergeCompanyDialog` pre-seeded, skipping search
- [ ] Existing 5a/5b flows (manual search-based merge) unaffected
- [ ] Each PR ≤10 files

## Resolution
Both decided as recommended: dismissal is session-only (component state, no new schema/table — revisit only if false positives turn out to be a recurring annoyance), and the check runs automatically on Companies page load (cheap at this data volume, passive discovery is the point of "auto-suggest").

## Open Questions
None remaining.
