# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Boundaries

- Never commit `.env` files or secrets — `.gitignore` covers `.env*`, but double-check diffs before pushing.
- Ask before running `prisma migrate dev` against the shared dev DB or changing `schema.prisma` — e2e tests (`test:e2e`, `e2e-nightly.yml`) run against a live database and a bad migration affects everyone using it. See `backend/CLAUDE.md` ("Prisma 7 Quirks") for the post-migration `prisma generate` step.
- Don't skip lint/type-check/tests before committing — both `backend` and `frontend` are gated by CI (`.github/workflows/deploy.yml`, `frontend-ci.yml`) on every PR and push to `main`.
- Before considering frontend work done, run `npm run build` (not just `tsc --noEmit` or `npm run lint`) — Next.js's production type-check during `next build` catches library prop-type mismatches (e.g. recharts `Tooltip formatter`) that a standalone `tsc --noEmit` run misses.
- Never add a new dependency without checking bundle size (frontend) or necessity (backend) first.
- Match existing style over personal preference — see `git-workflow-and-versioning` guidance: commits are atomic, `Add X` / `Fix Y` / `Wrap Z` style titles, no body unless the why isn't obvious.
- Default to a lighter review pass (token budget is limited) — see "Personal preferences". Reserve a full deep adversarial `/code-review` for high-stakes changes (payments, auth, migrations) or when asked.
- Optional fields on a PATCH/update DTO must be typed `T | null`, not just `T | undefined`, and the frontend must send an explicit `null` (not `undefined`) to clear a field the user emptied out. `JSON.stringify` drops `undefined` keys entirely, and Prisma treats an omitted key as "leave the column alone" — only an explicit `null` clears it. See ADR-022 (`contacts.service.ts` / `contacts.tsx`) for the bug this caused and the fix.

## Personal preferences

- Commit messages: short single-line, no body unless why isn't obvious. Never mention Claude/Claude Code/Anthropic, no `Co-Authored-By` trailer.
- Solo user of this app right now — `EMAIL_FROM=onboarding@resend.dev` is fine, don't suggest custom domain/DNS verification unless multi-user comes up.
- User has limited tokens — okay with a lighter review pass by default. Still flag SDK error contracts (e.g. Resend returns `{error}` instead of throwing) and cross-module shared-field writes if spotted, but don't force a full `/code-review` pass unless asked or the change is high-stakes (payments, auth, migrations).
- PRs touching `frontend/**` or `backend/**` now run Playwright e2e as a merge-blocking check (`e2e-pr.yml`, since ADR-025), not just nightly — factor into CI-wait expectations.

## Patterns

- **Backend feature module:** `backend/src/modules/jobs/` — controller + service + `dto/` folder, one DTO file per shape. `backend/src/modules/contacts/` is a smaller, more recent example of the same shape. Copy this structure for new modules.
- **Child-of-job module ownership:** modules whose records belong to a `Job` (e.g. `contacts`, `interview-rounds`) scope every access through `ensureJobOwned(userId, jobId)` — an owner check on the parent `Job` — rather than adding a `userId` column to the child model. See ADR-015 and ADR-022.
- **Frontend form (RHF + Zod):** `frontend/components/jobs/job-form.tsx` — inline Zod schema, handles both create and edit paths in one component.
- **Frontend feature hooks:** `frontend/features/jobs/hooks.ts` — TanStack Query `useQuery`/`useMutation` hooks with the `['jobs', filters]` key convention described above, kept out of the route page. `features/profile/`, `features/admin/`, `features/dashboard/` follow the same shape. Route pages (e.g. `app/(dashboard)/jobs/page.tsx`) call these hooks and hold only local UI state.