# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Boundaries

- **Read `CONSTRAINTS.md` before writing code. Do not weaken it to make a change pass.** It holds this repo's quality floor, the enforced numbers, and the tracked exceptions. `npm run check:floor` checks the floor against your diff; `npm run check:migrations` checks a new migration declares its data-loss impact.

- **Read `docs/CODE-STYLE.md` before writing new files.** It holds this repo's naming grammar, file-suffix vocabulary, comment style, test phrasing and commit format, each with the evidence behind it. `CONSTRAINTS.md` is the quality floor; `CODE-STYLE.md` is what the code is supposed to read like.

- Never commit `.env` files or secrets — `.gitignore` covers `.env*`, but double-check diffs before pushing.
- **Branches (ADR-056).** Every change — features, urgent fixes and Dependabot bumps — goes to `develop` (the default branch) and is squash-merged. Only a release PR, `develop` → `main`, merges to `main`, and it uses a **merge commit**, never a squash.
- **Merging a migration to `main` migrates production automatically — there is no second approval gate.** `backend/Dockerfile.prod`'s CMD is `prisma migrate deploy && node dist/main`, so the deploy workflow's `docker compose up -d` restarts the container and the migration runs on startup. A destructive migration (`DROP COLUMN`, `DROP TABLE`) therefore takes effect on the prod Neon DB the moment the release PR merges to `main`; merging to `develop` does not deploy. Confirm the data loss with the user _before_ that merge, not before writing the migration, and list every migration a release carries on the release PR. A green GitHub deploy run only proves the container started, so verify with `prisma migrate status` inside it afterwards.
- Ask before running `prisma migrate dev` against the dev DB or changing `schema.prisma` — the local e2e suite (`test:e2e`) runs against that same Docker Postgres (`docker-compose.dev.yml`), and a bad migration there has to be rolled back by hand. See `backend/CLAUDE.md` ("Prisma 7 Quirks") for the post-migration `prisma generate` step.
- Don't skip lint/type-check/tests before committing — both `backend` and `frontend` are gated by CI (`.github/workflows/deploy.yml`, `frontend-ci.yml`) on every PR and push to `main` and `develop`.
- Before considering frontend work done, run `npm run build` (not just `tsc --noEmit` or `npm run lint`) — Next.js's production type-check during `next build` catches library prop-type mismatches (e.g. recharts `Tooltip formatter`) that a standalone `tsc --noEmit` run misses.
- Never add a new dependency without checking bundle size (frontend) or necessity (backend) first.
- Match existing style over personal preference — see `git-workflow-and-versioning` guidance: commits are atomic, `Add X` / `Fix Y` / `Wrap Z` style titles, no body unless the why isn't obvious.
- Run `/code-review` on every code PR before pushing or merging, at a level matched to the work, and triage the findings with the user — see "Personal preferences".
- Optional fields on a PATCH/update DTO must be typed `T | null`, not just `T | undefined`, and the frontend must send an explicit `null` (not `undefined`) to clear a field the user emptied out. `JSON.stringify` drops `undefined` keys entirely, and Prisma treats an omitted key as "leave the column alone" — only an explicit `null` clears it. See ADR-022 (`contacts.service.ts` / `contacts.tsx`) for the bug this caused and the fix.

## Personal preferences

- Commit messages: short single-line, no body unless why isn't obvious. Never mention Claude/Claude Code/Anthropic, no `Co-Authored-By` trailer.
- Solo user of this app right now — `EMAIL_FROM=onboarding@resend.dev` is fine, don't suggest custom domain/DNS verification unless multi-user comes up.
- Review depth scales with the work: `low` or `medium` for small changes (bug fixes, UI polish, config tweaks, dependency bumps), `high` for features and for auth, payments or migrations; `max` only when asked. Docs-only and CI-config-only PRs skip review. State the chosen level so it can be overridden. Watch especially for SDK error contracts (e.g. Resend returns `{error}` instead of throwing), cross-module shared-field writes, and deploy order.
- PRs touching `frontend/**` or `backend/**` run Playwright e2e as a merge-blocking check (`e2e-pr.yml`, ADR-025) — factor into CI-wait expectations.

## Patterns

- **Backend feature module:** `backend/src/modules/jobs/` — controller + service + `dto/` folder, one DTO file per shape. `backend/src/modules/contacts/` is a smaller, more recent example of the same shape. Copy this structure for new modules.
- **Child-of-job module ownership:** modules whose records belong to a `Job` (e.g. `contacts`, `interview-rounds`) scope every access through an owner check on the parent — `ensureJobOwned(userId, jobId)` in `interview-rounds`, `ensureOwner(userId, ref)` in `contacts` (whose parent is a job or a company) — rather than adding a `userId` column to the child model. See ADR-015 and ADR-022.
- **Frontend form (RHF + Zod):** `frontend/components/jobs/job-form.tsx` — inline Zod schema, handles both create and edit paths in one component.
- **Frontend feature hooks:** `frontend/features/jobs/hooks.ts` — TanStack Query `useQuery`/`useMutation` hooks with the `['jobs', filters]` key convention (see `frontend/CLAUDE.md` → Data Fetching Conventions), kept out of the route page. `features/profile/`, `features/admin/`, `features/dashboard/` follow the same shape. Route pages (e.g. `app/(dashboard)/jobs/page.tsx`) call these hooks and hold only local UI state.
