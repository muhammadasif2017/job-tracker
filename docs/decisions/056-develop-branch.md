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

- **`main` is the primary and default branch: it is what runs in production.**
  `develop` is the pre-production branch, where changes are tested together
  before a release takes them to `main`. Feature PRs target `develop` and are
  squash-merged. `develop` requires the same four checks as `main`, and
  requires a PR to be up to date with it.
- **A release is a PR from `develop` to `main`, merged with a merge commit.**
  A squash would leave `develop` and `main` with different histories, so every
  later release would conflict. `main` does not require a PR to be up to
  date: each release adds a merge commit that only `main` has, so `develop`
  is never up to date with `main` after the first release. The merge commit
  changes no files, so this is harmless.
- **Every change goes through `develop`**, including urgent fixes and
  Dependabot bumps (`target-branch: develop` in `dependabot.yml`). Nothing
  merges to `main` except a release PR, so `main` never holds a change that
  `develop` lacks.
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
- An urgent fix reaches production through a release, which also ships
  whatever else is on `develop` at the time.
- A first version of this ADR sent hotfixes and Dependabot straight to `main`.
  That needed a workflow, and a personal access token, to merge `main` back
  into `develop` after each of them. It was dropped the same day for this
  simpler flow.
- Vercel deploys only `main`. `frontend/vercel.json` turns off
  `git.deploymentEnabled` for every other branch (`**` matches names with a
  `/`, such as Dependabot's), so feature branches, `develop` and PRs no longer
  spend the Vercel plan's deployment limit on previews nobody can log in to.
- The nightly e2e run uses the default branch, so it tests `main`.
- `gh pr create` and the GitHub UI default a new PR to `main`, so a PR must
  name `develop` as its base. `pr-after-push.sh` does this for PRs it opens.
  The required `Release source` check (`release-source.yml`) fails any PR to
  `main` whose source is not `develop`.
- The local hooks treat `develop` like `main`: no direct commits or pushes.
