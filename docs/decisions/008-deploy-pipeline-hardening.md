# ADR-010: Harden the GitHub Actions deploy pipeline

## Status
Accepted

## Date
2026-06-20

## Context

`.github/workflows/deploy.yml` builds the backend Docker image and deploys it to
the Oracle Cloud VM on every push to `main`. A review of the pipeline surfaced
several gaps:

1. **No quality gate.** The pipeline went straight from `push` to `docker build`
   to `docker compose up -d` on the prod VM. A commit that failed to typecheck or
   broke a unit test would still build and deploy — the first signal of breakage
   would be the prod container crashing or 500ing.
2. **No image provenance.** Only `:latest` was pushed. If a bad deploy needed to
   be rolled back, there was no previous image reference to roll back to —
   `:latest` had already been overwritten.
3. **No build cache.** Every push rebuilt the backend image from scratch
   (`docker/build-push-action` with no `cache-from`/`cache-to`), burning CI
   minutes on unchanged layers (npm install, Prisma generate, etc.).
4. **No concurrency control.** Two pushes to `main` in quick succession could run
   two `deploy` jobs concurrently. Both jobs run `docker compose pull && up -d`
   against the same VM — interleaved runs could pull a newer image but apply it
   out of order with an older `build-push` job still in flight.
5. **`workflow_dispatch` had no branch restriction.** The manual-trigger UI lets
   a user pick any ref. Triggering the workflow against a feature branch would
   build and deploy unreviewed code straight to prod.

## Decision

1. Add a `test` job (`npm ci` → `tsc --noEmit` → `npx jest`) as a prerequisite
   for `build-push`. e2e tests are intentionally excluded from this job — they
   require a live PostgreSQL instance the CI runner doesn't have; unit coverage
   plus typechecking is the bar for "safe to build an image."
2. Push two tags per build: `:latest` (what `docker-compose.prod.yml` references)
   and `:${{ github.sha }}` (a permanent, addressable reference for manual
   rollback — `docker pull ...:<sha>` then retag to `:latest` on the VM).
3. Add `cache-from: type=gha` / `cache-to: type=gha,mode=max` to the build step.
4. Add a workflow-level `concurrency: { group: deploy-backend, cancel-in-progress: false }`.
   `cancel-in-progress: false` is deliberate — canceling a run mid-`docker compose
   up -d` would leave the VM in a worse state than waiting; runs queue instead of
   colliding.
5. Add `if: github.ref == 'refs/heads/main'` to all three jobs (`test`,
   `build-push`, `deploy`), not just the first. `build-push`/`deploy` already
   skip transitively via `needs: test` skipping, but the explicit guard on each
   job is defense-in-depth: if a future edit inserts a job between `test` and
   `build-push` without wiring `needs` correctly, the guard still holds.

## Alternatives Considered

### Run e2e tests in CI before deploy
- Pros: closer to full confidence than unit tests alone
- Cons: requires standing up a PostgreSQL service container in CI, plus Redis
  for the enrichment queue; adds real setup cost for a portfolio-scale pipeline
- Rejected for now: unit tests + typecheck catch the overwhelming majority of
  regressions this project actually produces; e2e-in-CI is a future upgrade, not
  a blocker

### Automated rollback (deploy job reverts on health-check failure)
- Pros: closes the loop fully — bad deploys self-heal
- Cons: needs a health-check step wired into the `deploy` job and rollback
  logic in the SSH script; meaningfully larger scope than this pass
- Rejected for now: the SHA tag gives a manual rollback path, which is
  proportionate to a single-VM, single-maintainer deployment

### Per-job `environment:` protection rules (GitHub Environments with required reviewers)
- Pros: native GitHub feature, adds a manual approval gate before deploy
- Cons: requires a paid plan feature set or extra config for a one-person repo;
  the `workflow_dispatch` branch guard already closes the main accidental-deploy
  risk
- Rejected: disproportionate for the current team size of one

## Consequences

- A failing `tsc` or `jest` run now blocks the image from ever being built —
  prod can no longer receive a commit that doesn't typecheck or pass unit tests.
- Rollback is possible via SSH: `docker pull ghcr.io/.../job-tracker-backend:<sha>`,
  retag, `docker compose up -d` — manual, but no longer impossible.
- CI build times drop on pushes that don't change `backend/package.json` or
  source significantly, since unchanged Docker layers are pulled from the GHA
  cache instead of rebuilt.
- Two pushes to `main` within the same deploy window now queue rather than race;
  the second deploy always lands after the first fully completes.
- Manually triggering the workflow from a non-`main` ref is now a no-op (all
  three jobs skip) instead of a silent prod deploy of unreviewed code.
