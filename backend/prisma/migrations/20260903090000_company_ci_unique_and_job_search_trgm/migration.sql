-- Case-insensitive uniqueness on a user's company names.
--
-- This is what lets JobsService.resolveCompanyId be a plain create with a
-- P2002 fallback instead of a Serializable transaction wrapped in a retry
-- loop: the old case-insensitive findFirst had no index to match, so under
-- Serializable it predicate-locked the user's whole (userId, name) range and
-- two creates for unrelated company names aborted each other.
--
-- Prisma has no functional-index syntax, so this index is raw SQL and is NOT
-- represented in schema.prisma -- see backend/CLAUDE.md "Prisma 7 Quirks".
-- If a user already holds two companies whose names differ only by case,
-- this statement fails; merge them in the Companies UI and re-run.
CREATE UNIQUE INDEX "companies_userId_lower_name_key"
  ON "companies" ("userId", lower("name"));

-- buildJobWhere normalizes the *search term* to NFKC so styled Unicode
-- pasted from LinkedIn matches normally-typed text. Rows written before
-- CreateJobDto started normalizing on write are still in their original
-- form, so the term could never match them. Fold them now (idempotent;
-- NULL stays NULL).
UPDATE "Job" SET
  "company"  = normalize("company", NFKC),
  "position" = normalize("position", NFKC),
  "location" = normalize("location", NFKC),
  "notes"    = normalize("notes", NFKC)
WHERE "company"  IS DISTINCT FROM normalize("company", NFKC)
   OR "position" IS DISTINCT FROM normalize("position", NFKC)
   OR "location" IS DISTINCT FROM normalize("location", NFKC)
   OR "notes"    IS DISTINCT FROM normalize("notes", NFKC);

-- Job search is `ILIKE '%term%'` across four free-text columns (buildJobWhere),
-- which no B-tree index can serve -- it was a sequential scan on every
-- keystroke of the debounced search box. Trigram GIN indexes are the one
-- index type Postgres can use for an unanchored ILIKE.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Job_company_trgm_idx"  ON "Job" USING GIN ("company"  gin_trgm_ops);
CREATE INDEX "Job_position_trgm_idx" ON "Job" USING GIN ("position" gin_trgm_ops);
CREATE INDEX "Job_location_trgm_idx" ON "Job" USING GIN ("location" gin_trgm_ops);
CREATE INDEX "Job_notes_trgm_idx"    ON "Job" USING GIN ("notes"    gin_trgm_ops);
