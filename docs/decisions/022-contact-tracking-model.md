# ADR-022: Per-job contact/recruiter tracking as a single `Contact` model

## Status
Accepted

## Date
2026-08-02

## Context

Users want to track who they're talking to for a given job — recruiter,
hiring manager, referral — with name, role, email, phone, LinkedIn URL, and
free-text notes. No such entity existed; contact info was only ever
captured ad hoc inside a job's free-text notes.

Two design questions needed answers before implementation: whether
"recruiter" deserves its own model distinct from other contact types, and
how a PATCH endpoint should let a user clear a field they'd previously set
(a general problem with optional-field PATCH DTOs, not unique to contacts).

## Decision

### One `Contact` model, `role` as a free-text field, not an enum

```prisma
model Contact {
  id          String   @id @default(cuid())
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  name        String
  role        String?
  email       String?
  phone       String?
  linkedinUrl String?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([jobId])
  @@map("contacts")
}
```

`role` is a plain optional string (`"Recruiter"`, `"Hiring Manager"`,
whatever the user types), not a `Recruiter` vs. `Contact` split or a
`ContactRole` enum. A job's contacts are a handful of named people in
different capacities — modeling "recruiter" as a distinct entity would mean
either duplicating the whole shape (name/email/phone/linkedin/notes) across
two models, or an artificial subtype relationship for no query benefit
CLAUDE.md's own backend module pattern doesn't need.

`onDelete: Cascade` on the `job` relation — contacts have no meaning
outside their owning job; deleting a job should not leave orphaned rows.

### Ownership always checked through the parent `Job`, not on `Contact` directly

Every service method (`create`, `findAllForJob`, `update`, `remove`) calls
`ensureJobOwned(userId, jobId)` first — `Job.userId` is the only ownership
check; `Contact` itself carries no `userId`. This mirrors `InterviewRound`
(ADR-015): child records of a job are scoped through the job, not
duplicated with their own owner column.

### Soft cap of 20 contacts per job

`MAX_CONTACTS_PER_JOB = 20`, enforced in `create` with a `BadRequestException`
before insert. Explicitly not a security boundary — contacts are already
scoped to the owning user via `ensureJobOwned`. It exists to bound
unbounded growth from a scripted/misbehaving client, not to model any
real-world limit on how many people you'd track for one job application.

### PATCH accepts explicit `null` to clear a field, distinct from omitted/`undefined`

Fixed one commit after the initial implementation: the first version typed
optional `CreateContactDto` fields as `string | undefined`, and the
frontend's `buildPayload()` sent `form.role || undefined` for a blanked-out
field. Since `JSON.stringify` drops `undefined` keys entirely, an emptied
field never reached the request body — Prisma's `update` treats an omitted
key as "leave the existing value alone," so clearing a field in the UI had
no effect on the stored value.

Fix: DTO fields widened to `string | null` (`role?: string | null`, etc.),
and the frontend sends `form.role || null` instead of `|| undefined`.
Prisma's `update` distinguishes an explicit `null` ("set this column to
NULL") from an omitted key ("don't touch this column") — only the null form
can express "clear it" over a partial-update API.

## Alternatives Considered

### Separate `Recruiter` model, or a `ContactRole` enum
Rejected: no query or filtering need is gated on role today (no "list all
recruiters across jobs" feature exists), so an enum would only constrain
free-text input a user might reasonably want to type differently
("Recruiter (contract)"). Free-text `role` can be promoted to an enum later
if a real cross-job query need for it appears — reversible, unlike a schema
split.

### `userId` directly on `Contact` instead of checking through `Job`
Rejected: would duplicate the ownership check surface and create a second
place `userId` could drift from the owning job's — same reasoning as
`InterviewRound`'s design in ADR-015. Every access path already goes
through a `jobId`, so checking ownership via `ensureJobOwned` is both
sufficient and consistent with the rest of the codebase.

### Represent "clear this field" with a sentinel value (e.g. empty string) instead of `null`
Rejected: `email`/`linkedinUrl` are validated with `@IsEmail()`/`@IsUrl()`
when present — an empty string would either fail validation or require
special-casing in every validator, whereas `@IsOptional()` combined with a
`| null` type lets `class-validator` skip validation on `null` the same way
it already does for `undefined`.

## Consequences
- Any future optional-field PATCH DTO in this codebase should default to
  the `T | null` pattern from the start (accept explicit `null` to clear),
  not `T | undefined` — this bug class will recur on any new editable
  optional field otherwise.
- Adding a queryable notion of "role" (e.g. filter jobs by whether a
  recruiter contact exists) requires either a migration to an enum or a
  string `LIKE` query against free text — not designed in.
- The 20-contact cap is enforced only in `ContactsService.create`; raising
  or removing it is a one-line change with no migration required.
