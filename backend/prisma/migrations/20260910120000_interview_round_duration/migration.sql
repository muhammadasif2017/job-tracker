-- data-loss: none
--
-- Adds `durationMinutes` to `interview_rounds` (ADR-043). Purely additive: an
-- ALTER TABLE ... ADD COLUMN with no default and no NOT NULL, so no existing
-- row is rewritten and no value is destroyed.
--
-- Nullable on purpose. Every round created through the app from now on carries
-- a length the user typed (the DTO requires it), but rounds written before this
-- migration never recorded one. Those read null and the calendar export falls
-- back to DEFAULT_ROUND_MINUTES rather than inventing a length nobody chose.
-- Deliberately not backfilled, for the same reason ADR-034 declined to backfill
-- `appliedAt`: the value would be a guess, and it would write production rows on
-- merge rather than only changing the schema.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX for
-- the five raw indexes that are not represented in schema.prisma (the functional
-- unique index on companies (userId, lower(name)) and the four pg_trgm GIN
-- indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "interview_rounds"
  ADD COLUMN "durationMinutes" INTEGER;
