# ADR-042: Exclude Site-Scanner Output From `techStack`, and Feed Tracked Job Titles Into the Context

## Status
Accepted

## Date
2026-09-06

## Context
`techStack` was the most visibly wrong field in company enrichment. Live runs
returned `["Mixpanel","C","Dart"]` for Systems Limited and
`["Microsoft Clarity","HashiCorp Terraform","Webpack","Twemoji","JSON-LD"]` for
Arbisoft — identical before and after the context-assembly fixes of ADR-038 and
ADR-039, because the values never came from the official site at all. They came
from Tavily snippets that surface third-party site-scanner pages, which report
what a marketing site was built with. Twemoji and JSON-LD are not an
engineering stack.

Nothing in the pipeline carried first-party technology names. A homepage says
what a company sells; search snippets say what its CDN is.

## Decision
1. Tell the model what the field is for. `techStack` gains a schema
   `description` (languages, frameworks, databases, cloud platforms — not
   website infrastructure), and the prompt names the excluded categories with
   examples drawn from the observed bad output, instructing `[]` rather than a
   list of them.
2. Add a `=== ROLES THE USER TRACKED AT THIS COMPANY (first-party) ===` section
   built from the `position` of every `Job` linked to the company, deduped.
   "Senior React Developer" is a technology fact about this employer that no
   other source in the pipeline provides.

Only `position` is selected. `notes` is the user's private free text — recruiter
names, salary discussion — and carries no technology signal, so it stays out of
the prompt.

## Alternatives Considered

### Post-filter the extracted list against a denylist
- Rejected: an unbounded category. Every analytics vendor, CDN and polyfill
  would need listing, and a legitimate stack entry could collide.

### Drop `techStack` entirely
- Rejected: it is one of the fields that actually moves an apply/skip decision
  (`docs/specs/target-companies.md`). The source was wrong, not the field.

### Fetch a `/careers` or engineering-blog page for stack names
- Rejected: measured in ADR-040. Careers pages on the tested sites name no
  technologies and hide listings behind JavaScript.

## Consequences
- The job query added here is shared with nothing else; it is one indexed read
  (`@@index([companyId])` on `Job`) per enrichment run.
- A company with no tracked jobs yet gets no ROLES section, which is the
  common case for a target company added before applying anywhere.
- Prompt-level exclusion is instruction-following, not a guarantee — the same
  class of mitigation ADR-013 found insufficient for `address`. It is
  acceptable here because a wrong `techStack` entry is cosmetic, where a wrong
  street address was not. If it proves insufficient, the next step is a
  post-extraction filter, not more prompt text.
