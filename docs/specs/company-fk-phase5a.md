# Spec: Core Company Merge (Canonical Pick + Reassignment), Phase 5a

Parent: [company-fk-phase5.md](company-fk-phase5.md), first of three sub-phases (5a core merge, 5b field-by-field conflict picker, 5c auto-suggest detection) — split after phase 5's scope grew beyond a single 2-PR plan. Depends on phase 4 complete (single `Company` model, no `CompanyProfile`).

## Objective

Manual-trigger-only merge: user picks two companies, explicitly names which one is canonical, confirms, and the duplicate is merged into the canonical row. No auto-suggestion yet (5c), no field-by-field conflict resolution yet (5b — this phase always keeps canonical's own enrichment fields as-is, deferring conflict UI). This phase is the foundation both 5b and 5c build on.

Success: merging reassigns every `Job` and every `Contact` pointing at the duplicate to the canonical company, then deletes the duplicate — zero data loss, single transaction, cross-user merge structurally rejected.

## Tech Stack
NestJS transactional endpoint, Next.js confirmation dialog.

## Commands
Same as phase 1.

## Correction vs. phase5.md

The parent spec's "Code Style" only mentioned reassigning `Job.companyId`. **`Contact.companyId` also needs reassignment** — `Contact` has `onDelete: Cascade` from `Company` (`schema.prisma`), so deleting the duplicate `Company` without first reassigning its contacts would silently cascade-delete them. Both `Job` and `Contact` must be reassigned inside the same transaction, before the duplicate is deleted.

## Project Structure
```
backend/src/modules/companies/companies.controller.ts       → POST /companies/:id/merge
backend/src/modules/companies/companies.service.ts           → mergeCompanies transaction
backend/src/modules/companies/dto/merge-company.dto.ts (new) → { duplicateCompanyId: string }
backend/src/modules/companies/companies.service.spec.ts      → unit tests
frontend/features/companies/hooks.ts                         → useMergeCompanies mutation
frontend/components/companies/merge-company-dialog.tsx (new) → pick two companies, confirm, merge
```
~5 backend files, ~2-3 frontend files — split into 2 PRs (backend first, frontend second), consistent with every other phase.

## Code Style

Endpoint: `POST /companies/:id/merge` where `:id` is the **canonical** company (the one that survives), body `{ duplicateCompanyId: string }`. Matches the existing `PATCH /companies/:id` / `POST /companies/:id/enrichment` URL convention (`:id` = the company being acted on).

```ts
async mergeCompanies(userId: string, canonicalId: string, duplicateId: string) {
  if (canonicalId === duplicateId) {
    throw new BadRequestException('Cannot merge a company with itself');
  }
  return this.prisma.$transaction(async (tx) => {
    const [canonical, duplicate] = await Promise.all([
      tx.company.findFirst({ where: { id: canonicalId, userId }, select: { id: true, name: true } }),
      tx.company.findFirst({ where: { id: duplicateId, userId }, select: { id: true, name: true } }),
    ]);
    if (!canonical || !duplicate) throw new NotFoundException('Company not found');

    await tx.job.updateMany({ where: { companyId: duplicateId }, data: { companyId: canonicalId } });
    await tx.contact.updateMany({ where: { companyId: duplicateId }, data: { companyId: canonicalId } });
    await tx.company.delete({ where: { id: duplicateId } });

    return canonical;
  });
}
```

Explicit `userId` match on **both** `canonical` and `duplicate` independently (not relying on the FK alone) — closes any path where a crafted `duplicateCompanyId` from another user's account could be merged in. Both `findFirst` calls scoped by `userId` inside the same transaction as the reassignment/delete, so there's no TOCTOU window between the ownership check and the mutation.

## Testing Strategy
- Unit: reassigns all jobs AND all contacts, deletes duplicate, canonical's own fields unchanged. Cross-user merge attempt (duplicate belongs to another user) → `NotFoundException`, no mutation. Merging a company with itself → `BadRequestException`. Duplicate has zero jobs/contacts → merge still succeeds (empty `updateMany` is a no-op, not an error).
- E2e: merge two companies each with a job and a contact, confirm both land on the canonical company and the duplicate is gone (`GET /companies/:id` 404s for the old id).
- Frontend: dialog requires selecting both companies and clicking a distinct confirm step (not a single click) before the mutation fires.

## Boundaries
- Always: reassign `Job` and `Contact` before deleting the duplicate, all inside one transaction — no partial state reachable on failure.
- Ask first: none beyond normal PR review.
- Never: infer which company is canonical — the endpoint's `:id` param IS the explicit user choice, no heuristic fallback.

## Success Criteria
- [ ] Merge endpoint reassigns jobs + contacts, deletes duplicate, all in one transaction
- [ ] Cross-user merge attempt rejected with 404 (tested explicitly)
- [ ] Self-merge rejected with 400
- [ ] Frontend requires an explicit confirm step naming both companies before executing
- [ ] Each PR ≤10 files

## Open Questions
None — this phase deliberately excludes the two harder pieces (conflict picker, auto-suggest), deferred to 5b/5c.
