# ADR-056: Features go through develop before main

## Status

Accepted.

## Date

2026-10-06

## Context

Every PR merged to `main` went live at once. The deploy workflow rebuilds and
restarts the backend on a push to `main`, and the container runs
`prisma migrate deploy` on startup. Vercel builds the production frontend from
`main`. CI checks each PR on its own, so two changes that each pass can still
break together, and nothing let a set of features be checked together before
it reached users.

## Decision

- **`develop` is the integration branch and the default branch.** Feature PRs
  target `develop` and are squash-merged. `develop` has the same protection as
  `main`: the four required checks, kept up to date.
- **A release is a PR from `develop` to `main`, merged with a merge commit.**
  A squash would leave `develop` and `main` with different histories, so every
  later release would conflict.
- **Hotfixes go straight to `main`** from a `hotfix/<name>` branch, squash
  merged. `pr-after-push.sh` opens `hotfix/*` PRs against `main` and every
  other branch's PR against `develop`.
- **Dependabot targets `main`** (`target-branch` in `dependabot.yml`), so
  dependency bumps do not wait for a release.
- **`main` is synced back into `develop` after every push to `main`.**
  `sync-develop.yml` opens or refreshes a `sync/main-into-develop` PR, with
  `develop` already merged in so the PR is up to date. Merge it with a merge
  commit. A release PR cannot merge while `develop` is missing a hotfix or a
  bump, because `main` requires PRs to be up to date.
- **CI runs on both branches.** Every workflow that ran on PRs and pushes to
  `main` also runs on `develop`. The floor, migration and coverage guards diff
  against the PR's target branch. On a push they compare the branch with
  itself, as they always did on `main`. The deploy jobs run only on
  `refs/heads/main`.
- **No staging environment.** `develop` is verified by CI and the e2e suite.
  A Vercel preview of `develop` cannot call the production API, because CORS
  allows only `FRONTEND_URL`, and allowing it would point an unreleased
  frontend at production data.

## Consequences

- A migration reaches production when the release PR merges, not when its
  feature PR merges. One release can carry several migrations, so confirm the
  data loss of all of them on the release PR.
- `sync-develop.yml` needs a fine-grained personal access token in the
  `SYNC_DEVELOP_TOKEN` secret, with Contents, Pull requests and Workflows
  read/write on this repository. A branch pushed with `GITHUB_TOKEN` starts no
  workflows, so the sync PR's required checks would never run.
- When `main` and `develop` conflict, the sync PR opens without the merge, and
  a person resolves the conflict on the sync branch.
- The nightly e2e run uses the default branch, so it now tests `develop`.
- The local hooks treat `develop` like `main`: no direct commits or pushes.
