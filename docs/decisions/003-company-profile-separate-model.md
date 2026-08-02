# ADR-003: CompanyProfile as a separate 1:1 model (not embedded in Job)

## Status
Accepted

## Date
2026-06-12

## Context

Company enrichment data needs to be persisted alongside a job. The data has two
parts: **status metadata** (whether enrichment has run, whether it succeeded, any
error message) and **payload** (the extracted fields: industry, tech stack, etc.).

The question is where this data lives in the schema relative to the `Job` model.

## Decision

Store enrichment data in a separate `CompanyProfile` model with a 1:1 relation to
`Job` (`jobId String @unique`), with `onDelete: Cascade`.

```prisma
model CompanyProfile {
  id           String           @id @default(cuid())
  jobId        String           @unique
  job          Job              @relation(fields: [jobId], references: [id], onDelete: Cascade)
  status       EnrichmentStatus @default(PENDING)
  industry     String?
  techStack    String[]
  // ... other payload fields
  errorMessage String?
  enrichedAt   DateTime?
}
```

The `Job` model has `companyProfile CompanyProfile?` — the relation is optional
because jobs that haven't been enriched yet won't have a profile row.

## Alternatives Considered

### Option A: Embed as a JSON column on Job

```prisma
model Job {
  // ...
  enrichment Json?  // { status, industry, techStack, ... }
}
```

- **Pros:** One table; no JOIN needed; simpler schema.
- **Cons:** JSON columns lose type safety in Prisma. The `EnrichmentStatus` enum
  can't be used inside JSON. Filtering or indexing on enrichment fields is difficult.
  The `Job` row payload grows by ~500 bytes for every completed enrichment.
- **Rejected:** Type safety is a core project value; the `EnrichmentStatus` enum
  and the clean ON DELETE CASCADE behaviour are easier to reason about in a typed
  relational model.

### Option B: Nullable columns directly on Job

```prisma
model Job {
  // ...
  enrichmentStatus    EnrichmentStatus?
  industry            String?
  techStack           String[]
  // ... ~8 more nullable columns
}
```

- **Pros:** No JOIN; enum works; type-safe.
- **Cons:** Adds 10+ nullable columns to the `Job` model. The `jobs` table row width
  grows significantly. The `GET /jobs` list endpoint would always fetch enrichment
  data even though it's never shown in the list view — over-fetching at the DB level.
  The `Job` model conceptually represents a *job application*; enrichment data is
  *external intelligence about a company* — mixing them violates separation of
  concerns.
- **Rejected:** Core model pollution; unnecessary data transfer on list queries.

## Consequences

- `GET /jobs/:id` (detail page) uses `include: { companyProfile: true }` to fetch
  the enrichment data in one query.
- `GET /jobs` (list page) omits the `include`, so the enrichment JOIN never runs
  for list queries. This is a meaningful performance difference when the list returns
  many jobs.
- `JobsService.findOwned()` (used in write operations) does a lean `select: { id, status }`
  with no `include` — the companyProfile JOIN only happens when the data is actually
  needed (GET /jobs/:id).
- Cascade delete is handled by the DB: deleting a `Job` automatically deletes its
  `CompanyProfile`. No application-level cleanup needed.
- The enrichment worker checks `CompanyProfile` existence (by jobId) and silently
  exits if the row was deleted mid-flight (job deleted while enrichment was running).
