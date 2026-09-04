-- Drop two low-value enrichment columns from `companies`.
--
-- `workLifeBalance` was an LLM-guessed enum (Excellent/Good/Average/...) with
-- no ratings source anywhere in the pipeline — it duplicated `cultureSummary`
-- with less provenance. `founded` was display-only and never filtered,
-- sorted, or aggregated.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX
-- for the five raw indexes that are not represented in schema.prisma (the
-- functional unique index on companies (userId, lower(name)) and the four
-- pg_trgm GIN indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "companies"
  DROP COLUMN "workLifeBalance",
  DROP COLUMN "founded";
