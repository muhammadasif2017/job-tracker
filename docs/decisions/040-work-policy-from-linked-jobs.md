# ADR-040: Derive `workPolicy` from Linked Jobs, Not From a Careers-Page Fetch

## Status
Superseded by [ADR-041](./041-company-profile-drops-work-policy.md)

`Company.workPolicy` no longer exists, so there is nothing for the derivation
below to fill. The measurement that killed the `/careers` fetch still stands
and is the reason ADR-041 does not reach for one either.

## Date
2026-09-06

## Context
`workPolicy` returned `null` from every company enrichment run observed against
real sites — nine extraction runs across Systems Limited and Arbisoft, in both
the pre- and post-ADR-038 context assemblies. The model was behaving correctly:
homepages and `/about` pages state what a company does, not whether its people
work remote, hybrid or on-site. There was nothing in the context to extract.

The obvious fix was to fetch `/careers`. That premise was tested before being
built, and it failed:

| Site | `/careers` | technologies named | policy wording |
| --- | --- | --- | --- |
| arbisoft.com | 6384 chars | none | none |
| systemsltd.com | 3014 chars | none | none |
| netsoltech.com | 171 chars | none | none |
| innovation-insight.com | 404 | — | — |

Careers pages on these sites are recruiting-brand copy ("Creating an inclusive
& diverse environment", "Take your career to the next level") with the actual
listings behind a JavaScript widget that cheerio cannot execute. `/career` and
`/jobs` 404 everywhere tested. So the fetch would have added a third HTTP
request inside the 90s BullMQ `lockDuration` — undoing part of ADR-038's
reduction — in exchange for no policy signal at all.

Meanwhile the signal already exists in the database. `Job.jobType` is a
required enum (`ONSITE | HYBRID | REMOTE`) that the user sets per application,
and `Job.companyId` links those jobs to the `Company` row being enriched.

## Decision
Derive `workPolicy` from the user's own jobs at the company:

```ts
this.prisma.job.findMany({
  where: { companyId: company.id, userId: company.userId },
  select: { jobType: true },
})
```

Take the most common `jobType` and map it onto the same vocabulary the LLM tool
schema uses (`On-site` / `Hybrid` / `Remote`), so a derived value is
indistinguishable from an extracted one downstream.

Precedence in `buildCompletedProfileData` is extraction, then derived, then the
previous value: `data.workPolicy ?? derivedWorkPolicy ?? previous.workPolicy`.
A real extraction always wins; the derived value only fills a gap.

Two cases deliberately return nothing rather than a guess:

- **All jobs `ONSITE`.** `jobType` is `@default(ONSITE)` on `Job`, so a job
  whose field was never touched cannot be told apart from a deliberate on-site
  answer. An all-`ONSITE` set is read as no signal.
- **A tie between two types.** Two jobs, one remote and one hybrid, answer
  nothing about the company.

Do not fetch `/careers`. Do not add an `/about-us` fallback either: on the one
tested site whose `/about` 404s (innovation-insight.com), `/about-us` 404s too.

## Alternatives Considered

### Fetch `/careers` and let the LLM read it
- Rejected on measurement, above: no policy wording on any tested site, plus a
  third fetch inside the worker lock.

### Ask the LLM to infer policy from culture prose
- Rejected: that is guessing dressed as extraction. The prompt already
  instructs the model not to invent data, and a wrong Remote/On-site claim is
  worse than `Unknown` for someone deciding whether to apply.

### Majority vote including all-`ONSITE` sets
- Rejected: it turns a schema default into an assertion about the employer.
  Most users never touch `jobType`, so this would stamp "On-site" on nearly
  every company.

### Headless browser for the careers listing widget
- Rejected for now: a browser dependency for one field on one page type is far
  past this app's weight. Reconsider only if several fields need JS-rendered
  content.

## Consequences
- `workPolicy` now fills for any company where the user has recorded at least
  one non-`ONSITE` job, without a network call or LLM token.
- The value reflects the user's own applications, not the employer's published
  policy. For a company where they applied to one remote role, "Remote" is a
  statement about that role. Accepted: it is the user's own data, and it beats
  the `null` that the field held in every observed run.
- `CompanyEnrichmentProcessor` now reads `Job`. It still writes only to
  `Company`; the read is scoped by `userId` and `companyId`, and the processor
  spec asserts both the scoping and that no Job write method exists.
- Enrichment gains one indexed query per run (`@@index([companyId])` on `Job`).
