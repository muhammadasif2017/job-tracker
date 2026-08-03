# ADR-025: Run Playwright e2e on PRs (path-filtered), not just nightly

## Status
Accepted

## Date
2026-08-03

## Context

Playwright e2e (`frontend/e2e/`) only ran on `e2e-nightly.yml`'s 03:00 UTC
cron. A regression merged to `main` during the day surfaced up to ~24h
later, by which point the breaking commit could be buried under unrelated
work, making bisection slower. This is exactly how the ambiguous
interview-round delete button selector broke (#114): it landed via
`frontend-ci.yml` (lint/typecheck/build/unit — no Playwright), and nightly
was the first run to catch it, a day after merge.

Full e2e also isn't free — spinning up Postgres/Redis, building the
frontend, and installing Playwright browsers takes real CI minutes.
Running it on every PR regardless of what changed would tax unrelated PRs
(e.g. a `docs/decisions/*.md` ADR-only change) for no benefit.

## Decision

New `e2e-pr.yml`, separate from `e2e-nightly.yml`:

- **Path-filtered via `dorny/paths-filter`**: the `e2e` job only runs when
  the PR touches `frontend/**`, `backend/**`, or the workflow file itself.
  A `changes` job computes `relevant` first; `e2e` gates on
  `needs.changes.outputs.relevant == 'true'`.
- **Playwright browsers cached** (`actions/cache@v4`, keyed on
  `runner.os` + the installed `@playwright/test` version) — install step
  only runs `--with-deps` on a cache miss, `install-deps` (OS deps only)
  on a hit.
- **Nightly kept as-is**, unfiltered, full suite — a safety net for
  environment drift (dependency updates, external service changes) that
  isn't tied to a code diff and so wouldn't trip a path filter.
- Alongside this, `deploy.yml`'s backend test job and `frontend-ci.yml`
  were given explicit `name:` fields (`Backend Tests` / existing frontend
  job names untouched) to dedupe ambiguous "test" job names once a second
  workflow could show up on the same PR's checks list.

## Alternatives Considered

### Fold e2e into `frontend-ci.yml` instead of a separate workflow
Rejected: `frontend-ci.yml` runs unconditionally on every push; e2e needs
its own path-filter gate and service containers (Postgres/Redis) that the
lint/typecheck/build job doesn't. Keeping it a separate workflow file
keeps the fast unconditional checks fast.

### Run full e2e on every PR, unfiltered
Rejected: taxes PRs that touch neither `frontend/` nor `backend/` (docs,
ADRs, CI-only changes elsewhere) with ~minutes of Postgres/Redis
bring-up and a full Playwright run for no coverage gained.

### Drop the nightly job now that PRs are gated
Rejected: the path filter only catches regressions caused by a diff in
`frontend/**`/`backend/**`. Nightly still catches drift with no
associated code change (e.g. a transitive dependency's breaking release,
an external API behavior change).

## Consequences
- A PR touching `frontend/` or `backend/` now blocks on e2e passing before
  merge (see root `CLAUDE.md`'s "gated on CI" boundary) — regressions like
  #114 are caught pre-merge instead of up to a day later on nightly.
- Two Playwright jobs now exist (`e2e-pr.yml`, `e2e-nightly.yml`) with
  near-duplicate step lists; a change to one (e.g. Node version bump,
  new env var) must be mirrored in the other or they'll silently drift
  apart.
- PRs outside `frontend/**`/`backend/**` (docs, ADRs, non-workflow CI
  files) skip e2e entirely and merge on the faster checks alone.
