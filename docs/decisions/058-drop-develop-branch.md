# ADR-058: Drop the develop branch

## Status

Accepted. Supersedes [ADR-056](./056-develop-branch.md).

## Date

2026-10-29

## Context

ADR-056 sent every change through `develop` and shipped it to `main` in a
separate release PR. For a solo project, that doubled the CI waits for every
change: once for the feature PR to `develop`, then again for the release PR to
`main`, plus a branch update in between. A one-line fix took two full CI runs
(about 10 minutes each with Playwright) before it reached production.

The safety the extra stage was meant to add already comes from elsewhere: every
PR runs the unit, e2e and Playwright suites, and ADR-057 deploys with no
downtime.

## Decision

- `main` is the only long-lived branch. Every PR, Dependabot bumps included,
  targets `main` and is squash-merged.
- The `Release source` workflow and its required check on `main` are removed.
  CI workflows trigger on `main` only.
- The `develop` branch is deleted.

## Consequences

- A merge to `main` deploys straight away. There is no pre-production branch to
  hold a change before release.
- A destructive migration still needs two deploys (ADR-057): one PR stops using
  the column, and a later PR, opened once the first is live, drops it. Before,
  two releases kept these apart; now two separate merges to `main` do.
- Dependabot PRs open against `main`.
