# ADR-041: Drop `Company.workPolicy`; Enrich `productDescription` and `businessMode` Instead

## Status
Accepted (supersedes ADR-040)

## Date
2026-09-06

## Context
`workPolicy` on `Company` answered "is this employer remote, hybrid or
on-site?". That question has no employer-level answer: work arrangement is a
property of an individual role, and the same company routinely posts a remote
role and an on-site one. The application already records it at the right level
— `Job.jobType` is a required `ONSITE | HYBRID | REMOTE` enum set when the user
creates a job.

So the column duplicated an answer that already existed, at a level where it
could only be wrong. It also measured badly: across nine live extraction runs
(Systems Limited, Arbisoft) it came back `null` every single time, because
company homepages and `/about` pages do not state work arrangements.

ADR-040 tried to rescue the field by deriving it from the user's linked jobs.
That was solving the wrong problem — deriving a company-level value from
job-level data is just the level confusion written out in code.

Meanwhile two columns that *are* company-level have existed on `Company` since
the target-companies work and were never populated by enrichment:
`productDescription` (what the company builds or sells) and `businessMode`
(`PRODUCT | SERVICES | HYBRID`). `schema.prisma` labelled both "AI-fillable",
but only the CSV importer and the company form ever wrote them.

## Decision
1. Drop the `workPolicy` column from `Company`
   (`20260906120000_drop_company_work_policy`). Remove it from the extraction
   tool schema, `CompanyData`, both response DTOs, the merge override set, the
   company form, and the profile card. `Job.jobType` is untouched.
2. Add `productDescription` and `businessMode` to `extract_company_data` and
   surface both on the profile card — "What They Build" and "Business Mode".
3. `businessMode` is validated against the Prisma enum in `sanitize()` before
   it can reach the database. It is the only extracted field Prisma types as an
   enum, so an off-enum generation would be a write error rather than merely
   odd text.

### Field precedence differs for `businessMode`
Every other extracted field follows Assumption 9 of
`docs/specs/target-companies.md` — a refresh overwrites:
`data.field ?? previous.field`. `businessMode` inverts it:
`previous.businessMode ?? data.businessMode`.

It is the one AI-fillable column the user also sets deliberately — by hand on
the company form, and as the third column of the bulk CSV import. Letting a
re-run overwrite it would discard a stated answer in favour of a guess. The
prose fields carry no comparable user intent, so they keep the usual behaviour.

## Alternatives Considered

### Keep the column, stop displaying it
- Pros: no migration, no data loss, reversible.
- Rejected by the user after the trade-off was spelled out. A column nothing
  reads or writes is a trap for the next person reading the schema.

### Keep `workPolicy` and derive it from `Job.jobType` (ADR-040)
- Rejected: derives a company-level claim from job-level data. "Remote"
  computed from one remote application is a statement about that application.

### Fetch `/careers` to populate `workPolicy`
- Rejected on measurement in ADR-040, and that measurement still holds:
  `/careers` on arbisoft.com (6384 chars) and systemsltd.com (3014 chars)
  contains no work-policy wording at all, and the listings sit behind a
  JavaScript widget cheerio cannot execute.

### Add a Glassdoor-style employer rating instead
- Deferred, not rejected. It needs a new column, Glassdoor blocks bots, and the
  Tavily snippets that would feed it are the same source that produced
  `["Twemoji","JSON-LD","Webpack"]` for `techStack`. Worth a separate decision
  once that source is trustworthy.

## Consequences
- **Destructive migration.** Per `CLAUDE.md`, merging this to `main` runs
  `prisma migrate deploy` on container restart, so every stored `workPolicy`
  value is dropped from the production Neon database at merge time with no
  second gate. Confirmed with the user before the migration was written.
- The profile card now answers "what does this company do?" rather than "where
  would I sit?" — the first is an employer property, the second was already on
  the job.
- `CompanyProfile` (job-detail) and `Company` (company-detail) keep the
  identical enrichment-field subset, which is what lets one card component
  render both. Both DTOs gained the two fields together.
- `productDescription` joins the merge conflict picker in place of
  `workPolicy`. `businessMode` stays canonical-wins with no picker, consistent
  with its new precedence rule and with the existing treatment of user-curated
  identity fields.
- `frontend/types/api.generated.ts` still lists `workPolicy`; it is generated
  from a running backend (`npm run generate:api-types`) and nothing imports it,
  so it is stale until someone regenerates it.
