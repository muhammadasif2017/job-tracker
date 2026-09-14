-- data-loss: none
--
-- Adds `ghostSuggestionDismissedAt` to `Job` (docs/specs/response-insights.md).
-- Purely additive: an ALTER TABLE ... ADD COLUMN with no default and no NOT
-- NULL, so no existing row is rewritten and no value is destroyed.
--
-- Nullable on purpose: null means "never dismissed", which is the correct state
-- for every existing job. Not backfilled.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX for
-- the five raw indexes that are not represented in schema.prisma (the functional
-- unique index on companies (userId, lower(name)) and the four pg_trgm GIN
-- indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "Job"
  ADD COLUMN "ghostSuggestionDismissedAt" TIMESTAMP(3);
