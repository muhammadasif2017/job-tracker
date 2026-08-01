# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Boundaries

- Never commit `.env` files or secrets — `.gitignore` covers `.env*`, but double-check diffs before pushing.
- Ask before running `prisma migrate dev` against the shared dev DB or changing `schema.prisma` — e2e tests (`test:e2e`, `e2e-nightly.yml`) run against a live database and a bad migration affects everyone using it.
- After every `prisma migrate dev`, run `prisma generate` — forgetting this leaves the TS client out of sync (see `backend/CLAUDE.md`, "Prisma 7 Quirks").
- Don't skip lint/type-check/tests before committing — both `backend` and `frontend` are gated by CI (`.github/workflows/deploy.yml`, `frontend-ci.yml`) on every PR and push to `main`.
- Before considering frontend work done, run `npm run build` (not just `tsc --noEmit` or `npm run lint`) — Next.js's production type-check during `next build` catches library prop-type mismatches (e.g. recharts `Tooltip formatter`) that a standalone `tsc --noEmit` run misses.
- Never add a new dependency without checking bundle size (frontend) or necessity (backend) first.
- Match existing style over personal preference — see `git-workflow-and-versioning` guidance: commits are atomic, `Add X` / `Fix Y` / `Wrap Z` style titles, no body unless the why isn't obvious.
- Always run a deep adversarial review (`/code-review` or equivalent) before treating any change touching external I/O (email, payment, third-party APIs) or a field written by more than one module as done — passing tests alone is not sufficient sign-off. First-pass self-review reliably misses third-party SDK error contracts (e.g. an SDK that returns `{error}` instead of throwing) and cross-module state interactions (e.g. one module resetting a stateful field another module depends on).

## Patterns

- **Backend feature module:** `backend/src/modules/jobs/` — controller + service + `dto/` folder, one DTO file per shape. Copy this structure for new modules.
- **Frontend form (RHF + Zod):** `frontend/components/jobs/job-form.tsx` — inline Zod schema, handles both create and edit paths in one component.
- **Frontend data-fetching page:** `frontend/app/(dashboard)/jobs/page.tsx` — TanStack Query with the `['jobs', filters]` key convention described above.