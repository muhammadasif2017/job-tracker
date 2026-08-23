# ADR-030: Guard unrelated job edits from re-resolving a resent company label; stop replacing the company-detail cache with a partial PATCH response

## Status
Accepted

## Date
2026-08-23

## Context

ADR-029 fixed FK drift between `Job.company` (label) and `Job.companyId` by
having `resolveCompanyId` run inside a Serializable transaction, and by
documenting (in `backend/CLAUDE.md`) that `JobsService.update` "only
re-resolves when the caller actually sends `dto.company`." That description
turned out to be true but insufficient: `JobForm` (both create and edit
paths) always includes the current `company` value on every submit — RHF
resends the pre-filled field whether or not the user touched it. So
`dto.company !== undefined` was true on **every** edit, not just edits that
changed the company.

The consequence: editing any unrelated field (status, notes, resume) on a
job silently re-ran `resolveCompanyId(userId, dto.company.trim())`. If the
linked `Company` had since been renamed or merged into another company
elsewhere (company-detail page, CSV import merge, admin action), this
re-resolve used the job's stale label to find-or-create a *different*
`Company` row and re-point `companyId` at it — undoing the rename/merge as
a side effect of an edit that had nothing to do with the company field.

Separately, `useUpdateCompanyMutation` (`frontend/features/companies/hooks.ts`)
called `qc.setQueryData(['company', id], company)` with the raw `PATCH
/companies/:id` response. That endpoint returns a bare `Company` row with no
`contacts`/`jobs` includes — only `GET /companies/:id` fetches those. Editing
a company's profile fields therefore wiped the contacts and jobs sections of
the company-detail page from the cache until the next unrelated refetch
happened to run.

## Decision

### Backend: treat a resent-but-unchanged label as a no-op

```ts
const trimmedCompany = dto.company.trim();
const matchesCurrentLabel =
  existing.companyId !== null &&
  trimmedCompany.toLowerCase() === existing.company.toLowerCase();
if (!matchesCurrentLabel) {
  const { company } = await this.resolveCompanyId(userId, trimmedCompany);
  data = { ...baseData, companyId: company?.id ?? null };
}
```

`findOne` (called by `update` before this check) now selects `company` and
`companyId` alongside `id`/`status` so `existing.company` is available for
the comparison. Case-insensitive compare matches `resolveCompanyId`'s own
case-insensitive find. Re-resolution now only fires when the submitted label
actually differs (case-insensitively) from what's on record — a genuine
company-field edit — not merely because the field was present in the
payload.

### Frontend: invalidate the company-detail cache instead of replacing it

```ts
qc.invalidateQueries({ queryKey: ['company', id] });
```

Matches every other mutation on this key. The PATCH response is still used
for `onUpdated?.(company)` and the toast; it's just no longer written
directly into the query cache.

## Alternatives Considered

### Only re-resolve when `dto.company !== existing.company` (byte-for-byte, no `.trim()`/case-fold)
Rejected: `resolveCompanyId` itself does a case-insensitive match, so a
byte-for-byte compare would re-resolve on a whitespace-only or
case-only resend (still spurious) while a case-fold compare correctly
treats those as unchanged.

### Have the frontend only send `company` in the PATCH body when the user actually edited that field, instead of a backend-side guard
Rejected: `JobForm` handles both create and edit through one RHF form
instance with no per-field dirty tracking wired up, and every other
`UpdateJobDto` field already follows the "always send the current form
state" pattern — special-casing one field's payload construction would be
inconsistent with the rest of the form and easy to regress. The backend
guard is also the only place that can compare against the *current* stored
label (post any external rename/merge); the frontend only has the label it
loaded the form with, which may itself be stale.

### Make `PATCH /companies/:id` return the full `contacts`/`jobs`-included shape (like `GET /companies/:id`) instead of switching the frontend to invalidate
Rejected: broader change to the PATCH response contract for a
list/relation the caller didn't touch, and still wouldn't help other
mutations that already invalidate this key — fixing the cache-write side is
smaller and keeps the endpoint's response shape scoped to what it actually
updates.

## Consequences

- Job edits can no longer silently undo a company rename/merge performed
  elsewhere, closing the gap ADR-029 left open. `backend/CLAUDE.md`'s
  `companyId` FK Resolution section needs updating — "only re-resolves when
  the caller actually sends `dto.company`" is no longer the operative guard;
  it's now "only re-resolves when the sent label differs from the stored
  one."
- A job edit that *does* intentionally change the company label still
  triggers the normal find-or-create path, unchanged from ADR-029.
- Any future PATCH mutation that writes a partial response shape into a
  query key also used by a richer GET should default to `invalidateQueries`
  over `setQueryData`, unless the two response shapes are known to match.
