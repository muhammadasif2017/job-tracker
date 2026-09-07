# Constraints

This is the bar for this repository: what "good enough to merge" means, with the
numbers already chosen so they don't get argued about per-PR. Every row names the
command that produces the verdict — a number with no command next to it is an
aspiration, not a constraint.

Last reviewed: 2026-09-07.

## Floor (always enforced)

Checked by `npm run check:floor` (`scripts/floor-guard.mjs`), diff-scoped against
`origin/main`. Runs on every commit via `.husky/pre-commit` and again in CI.

- No new suppression comments: `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`,
  `eslint-disable`, `istanbul ignore`, `nosemgrep`, `gitleaks:allow`
- No unfinished work: `TODO`, `FIXME`, an empty `catch {}`, a stub that throws
  "not implemented"
- No test made easier: no added `.skip` / `.todo`, no deleted test file, no net
  loss of assertions in a test that stayed (counted per file — a reformat rewraps
  assertions onto different lines without removing any)
- No secrets in source (`gitleaks`, CI)
- **This file does not get weakened to make a change pass.** A lowered number or
  a new Exceptions row is itself a floor violation, so it surfaces in review
  rather than sliding through. Tightening the bar is silent; loosening is loud.

Changing the bar deliberately is still allowed, and has to be — a guard that makes
every rule edit unmergeable just gets deleted by the first person who needs one.
Put a `Constraints-Change:` trailer in the commit message saying what changes and
why:

```
Constraints-Change: scope the dependency rule to production packages at CVSS 7.0+
```

The finding is still printed in full, with the trailer beside it; it stops
blocking. That is the whole mechanism: an edit to this file cannot be silent, but
it can be justified. A trailer with no reasoning is not a justification, and
reviewing it is the reviewer's job, not the guard's.

The floor passes on `main` as of the date above, with the exceptions listed at the
bottom.

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Floor | Zero violations | `npm run check:floor` | pre-commit, CI |
| Types (backend) | Zero type errors | `cd backend && npx tsc --noEmit` | pre-commit\*, CI |
| Types (frontend) | Zero type errors | `cd frontend && npx tsc --noEmit` | CI (`next build` also type-checks) |
| Lint | Zero eslint **errors** (warnings ratcheted below) | `npm run check:fast` in each package | pre-commit\*, CI |
| Formatting (frontend) | Zero files fail prettier | `cd frontend && npm run format:check` | pre-commit\*, CI |
| Migrations | Every new `migration.sql` declares `-- data-loss:` | `npm run check:migrations` | CI |
| Coverage: changed lines | ≥ 80% of changed executable lines covered | `node scripts/coverage-diff.mjs` | CI (**warn until 2026-09-21**) |
| Security: secrets | Zero findings in the working tree | `gitleaks detect --no-git --redact --no-banner` | CI (**warn until 2026-09-21**) |
| Security: dependencies | No **production** package at CVSS 7.0+ | `osv-scanner` + `node scripts/dep-scan-gate.mjs` | CI (**warn until 2026-09-21**) |
| E2E | Playwright suite green | `.github/workflows/e2e-pr.yml` | PR, merge-blocking (ADR-025) |

\* pre-commit runs `lint-staged` (prettier + eslint --fix on staged files) plus the
floor guard. Full `tsc --noEmit` runs in CI, not on commit — it is too slow for the
edit loop.

**Why 80% on changed lines, not on the project.** Project coverage is a number you
inherited; coverage of the lines a change added is one the change can actually move.
80% is high enough to force a test and low enough to allow a config line.

**Why `--redact` on gitleaks is not optional.** Without it the matched secret lands
in CI logs and in any agent transcript that reads them. Report the rule and the
location, never the value.

**Why the migration rule exists.** `backend/Dockerfile.prod`'s CMD is
`prisma migrate deploy && node dist/main`, so merging a migration to `main` migrates
production on the next container start — there is no second approval gate. The
`-- data-loss:` line is the only place the impact is stated while it is still
reversible. `scripts/migration-guard.mjs` rejects a destructive migration
(`DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`ALTER COLUMN ... TYPE`) that claims
`data-loss: none`. Confirm the loss with the repo owner before merging, not before
writing the migration.

**Why the dependency row needs a gate script.** `osv-scanner` has no severity or
dependency-group threshold: it exits 1 on any finding at any severity, including
dev-only packages that ship nothing. Run raw, it is stricter than this rule — it
was red on 42 findings the rule does not ask anyone to fix, which is how a check
gets ignored. `scripts/dep-scan-gate.mjs` reads the scanner's JSON and enforces
what is written here: production dependencies only (a package carrying
`dependency_groups` is reachable only through dev or optional), CVSS 7.0+, which
is the HIGH floor. Everything below the line is still printed, just not gated.
Widen the rule by editing this row and the script's `--min`, never by removing the
scan.

**The one external opinion.** `osv-scanner` reads a vulnerability database nobody
here maintains. Everything else in the table is judged by this project's own types,
lint config, or test suite — which proves the project agrees with itself. Keep at
least one external row.

## Measured, not yet enforced

Ratchets: recorded where the codebase is today, with a direction. A drop is the
finding; no argument about a target number is needed to adopt one. Tolerance 0.5%
absorbs drift when an unrelated file moves the number.

| Metric | Today (2026-09-07) | Direction |
|--------|--------------------|-----------|
| Backend coverage — statements | 87.24% | must not fall |
| Backend coverage — lines | 87.58% | must not fall |
| Backend coverage — branches | 75.84% | must not fall |
| Frontend coverage — statements | 80.92% | must not fall |
| Frontend coverage — lines | 81.21% | must not fall |
| Frontend coverage — branches | 80.56% | must not fall |
| Backend eslint warnings | 51 | must not grow |
| Frontend eslint warnings | 12 | must not grow |

Both numbers are measured over a pinned file list, so they do not drift as tests
add or drop imports. Backend: 116 files, `collectCoverageFrom` excluding specs,
`*.module.ts` and `main.ts`. Frontend: `app/`, `components/`, `features/`, `lib/`,
`store/`, `proxy.ts`, excluding tests and generated types.

Neither figure is comparable to anything recorded before 2026-09-07. The backend
pattern was `**/*.(t|j)s`, which matched almost nothing and silently reported only
test-touched files (49 of 134). The frontend had no coverage provider installed at
all — `@vitest/coverage-v8` was added on 2026-09-07, and its install also moved
vitest 4.1.10 → 4.1.11 inside the existing caret range. It is a devDependency, so
there is no bundle impact.

`gitleaks` runs with `--no-git`: it scans the working tree, not 300+ commits of
history. A historical finding is a remediation project, not a merge gate.

## Where each check runs

| Phase | Command | What runs | Budget |
|-------|---------|-----------|--------|
| Edit / commit | `.husky/pre-commit` | lint-staged (staged files) + floor guard | under 5s |
| Task end | `npm run check:task` in the package you touched | types, lint, tests with coverage (+ `next build` on frontend) | 1–3 min |
| CI | `.github/workflows/*` | all of the above plus secrets, dependencies, e2e | minutes |

Cost decides placement. Anything over a few seconds stays out of the edit loop —
a check that stalls the work gets switched off with `--no-verify`, and a gate people
switched off is worse than no gate, because the bar still looks like it exists.

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
| E1 | floor: suppressions | `frontend/app/layout.test.tsx` | `eslint-disable no-eval` and `@ts-expect-error` for a jsdom `matchMedia` stub — both are test-harness plumbing, not silenced production checks | @muhammadasif2017 | 2026-12-06 |
| E2 | floor: suppressions | `frontend/components/companies/merge-company-dialog.tsx:140` | `react-hooks/exhaustive-deps` disabled with a written reason at the call site | @muhammadasif2017 | 2026-12-06 |
| E4 | `@typescript-eslint/unbound-method` | `backend/**/*.spec.ts` | `expect(logger.warn)` passes a method reference that is never called through; the rule cannot tell that from a real unbound call. Turned off in `eslint.config.mjs` for spec files only | @muhammadasif2017 | permanent |

Exceptions carry an owner and an expiry because an exception unblocks you; deleting
the constraint unblocks everyone forever.

Two more were opened and closed the same day rather than tracked: the empty
`catch {}` in `components/layout/sidebar.tsx` now states why a failed
`/auth/logout` must not block local sign-out, and the ~74 frontend files failing
`prettier --check` were formatted in one pass so the check could go repo-wide.

## Warn phase

Per the setup decision on 2026-09-07: the floor blocks immediately; the numbered
rows marked **warn** report without failing the build until **2026-09-21**, so they
can be watched firing on real PRs before they gate a merge. A warn-phase check still shows **red** on the PR. `continue-on-error: true` stops a
job from failing the workflow, but the check run itself reports a failure, and that
is deliberate: a warn row that renders green is indistinguishable from a passing
one, and nobody watches a check that always looks fine. Red-but-non-blocking is the
honest signal. Do not "fix" it with `|| true` inside the step.

To flip them:

1. Drop `--warn` from the three `scripts/coverage-diff.mjs` call sites —
   `.github/workflows/deploy.yml`, `.github/workflows/frontend-ci.yml`, and the
   `check:coverage-diff` script in the root `package.json`. (The flag is passed at
   the call site; there is nothing to edit in the script itself.)
2. Remove `continue-on-error: true` from the `secrets` and `dependencies` jobs in
   `.github/workflows/constraints.yml`.
