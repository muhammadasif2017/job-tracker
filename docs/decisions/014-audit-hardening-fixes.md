# ADR-014: Hardening fixes from a graph-guided code audit (refresh-token race, stale resume key, CSV injection, cuid param validation)

## Status
Accepted

## Date
2026-07-18

## Context
A `/graphify` structural audit ranked `AuthService`, `JobsService`, and the
storage layer as the codebase's highest-connectivity ("god node") modules.
Manual review of those modules, followed by a full `npm test` / `test:e2e`
run, surfaced four independent defects. None were caught by the existing
test suite because the suite's mocks and fixtures matched the buggy
behavior rather than the intended behavior.

### 1. Refresh-token rotation race (`AuthService.refresh`)
ADR-004 established rotate-on-refresh with reuse detection (hardened further
in the `fix/refresh-token-reuse-detection` PR, merged as 76d8e13): presenting
an already-revoked token wipes every session for that user. The
implementation read `stored.revokedAt`, then — in a separate round-trip —
wrote `revokedAt: new Date()`. Two concurrent requests carrying the same
still-valid token could both read `revokedAt: null` before either wrote it,
so both would pass and both would mint new sessions — silently bypassing
the reuse-detection guarantee ADR-004 exists to provide.

### 2. Stale resume file servable after replace (`ResumesController.serveFile`)
The dev-only file-serve endpoint checked that a resume record existed for
the job embedded in the requested key, but never checked that the key was
the resume's *current* `storageKey`. `ResumesService.upload` deletes the
old file asynchronously and only logs on failure (an intentional
storage-first ordering — see the "Resumes: Upload Consistency" section of
the backend CLAUDE.md); if that delete failed, the old file stayed on disk
and stayed servable under its old key indefinitely, even after being
replaced.

### 3. CSV formula injection (`JobsService.exportCsv`)
`escape()` only doubled `"` characters (correct CSV quoting) but did nothing
about the spreadsheet formula triggers `= + - @`. A `company` or `notes`
value starting with one of those characters would be evaluated as a formula
by Excel/Sheets when the exported CSV was opened.

### 4. `ParseUUIDPipe` on `Job.id`, which is `cuid()` (`JobsController`)
Every model in `schema.prisma` uses `@default(cuid())`, never a UUID.
Commit `e4623ff` ("validate job ID params") added `ParseUUIDPipe` to all
four `:id` routes on `JobsController`. Since a cuid never matches the UUID
format, this made `GET/PATCH/DELETE /jobs/:id` and `GET /jobs/:id/events`
return `400` for every real job id — not just in tests, in production too.
Confirmed via `npm run test:e2e`: 6 of 22 tests failed with `expected 200,
got 400` until the pipe was removed.

## Decision

### 1. Atomic conditional update for rotation
Replace the read-then-write with a single atomic conditional update:
```ts
const { count } = await this.prisma.refreshToken.updateMany({
  where: { id: jti, revokedAt: null },
  data: { revokedAt: new Date() },
});
if (count === 0) {
  // Lost the race, or already rotated — treat identically to reuse.
  await this.prisma.refreshToken.deleteMany({ where: { userId } });
  throw new ForbiddenException('Refresh token invalid or expired');
}
```
Only one concurrent caller can match `revokedAt: null`; the database's row
lock serializes the two requests, not application code. The loser's
`count === 0` is now indistinguishable from — and handled identically to —
genuine token reuse, so the race collapses into the already-correct reuse
path instead of a new failure mode.

### 2. Verify the key, not just the job
Added `ResumesService.getFileInfo(userId, jobId)` (internal-only —
`storageKey` is never sent to clients, matching the existing rule in
`types/index.ts`) returning `{ storageKey, originalName }`. `serveFile`
now requires `fileInfo.storageKey === key`, 404-ing on any mismatch.
A dangling file from a failed async delete is now inert: it's still on
disk, but its key no longer matches the resume's live `storageKey`, and
`serveFile` only trusts the object token itself if it has just used a
storage key resolved from the DB — a code path we do not have.

### 3. Escape formula-trigger characters
Prefix a leading `'` on any cell whose value starts with `= + - @`,
matching OWASP's standard CSV-injection mitigation:
```ts
const escape = (v: string | null | undefined) => {
  const s = v ?? '';
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
```
Excel/Sheets treat a leading `'` as "force text," so the cell renders as
literal text. No real company/position/notes value legitimately starts
with those characters, so this has no effect on well-formed data.

### 4. Drop the format-validating pipe; rely on the existing 404 path
Removed `ParseUUIDPipe` from all four `:id` routes. `JobsService.findOne` /
`findOwned` already throw `NotFoundException` for any id that doesn't match
an owned row — malformed input degrades to the same 404 a nonexistent-but
otherwise-valid-looking id gets. This matches the pattern
`ResumesController` already used for `jobId` (a plain string param, no
format pipe).

## Alternatives Considered

### 1. Refresh race — mutex / distributed lock around `refresh()`
- Rejected: adds an external dependency (Redis lock or similar) for a
  problem the database's own row-level locking already solves for free via
  a conditional `UPDATE ... WHERE`.

### 2. Stale resume key — synchronous delete-then-upsert
- Would remove the dangling-file window entirely, but changes the
  intentional storage-first ordering documented in CLAUDE.md ("a dangling
  storage file is better than a DB record pointing at nothing"). Rejected
  as out of scope: the key-equality check closes the *access* hole without
  touching the deliberate write-ordering trade-off.

### 3. CSV injection — reject/strip formula-trigger characters instead of escaping
- Rejected: stripping the leading character would silently corrupt
  legitimate data (e.g., a company name that happens to start with `-`).
  The leading-`'` escape preserves the exact original value as literal text.

### 4. cuid param validation — write a custom `ParseCuidPipe` with a regex
- Considered (`cuid()` from `@paralleldrive/cuid2` used by Prisma has a
  variable length, so a strict regex must stay loose, e.g.
  `/^[a-z0-9]{20,32}$/`). Rejected in favor of removing the pipe entirely:
  the service layer's ownership check already turns any non-matching id
  into a `404`, so a format-check pipe only adds a redundant, drift-prone
  second definition of "valid id" with no behavioral benefit — and the
  existing definition (in the pipe) was already wrong once.

## Consequences
- Concurrent refresh requests against the same token now always resolve to
  exactly one winner; the loser (whether a genuine race or an actual replay)
  triggers the full-session wipe, matching ADR-004's intended guarantee.
- `serveFile` 404s on any storage key that isn't the resume's current one,
  even if the physical file still exists on disk from a failed cleanup.
- Exported CSVs are safe to open directly in Excel/Sheets regardless of
  user-entered `company`/`position`/`notes`/`url` content.
- `/jobs/:id` routes accept any string id; malformed ids 404 exactly like
  valid-looking-but-nonexistent ones (no information leak either way).
- Existing unit test mocks (`auth.service.spec.ts`,
  `resumes.controller.spec.ts`) were updated to mock `updateMany` and
  `getFileInfo` respectively — both suites now assert against the new
  atomic/verified behavior instead of the old one.
