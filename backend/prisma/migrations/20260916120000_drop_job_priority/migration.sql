-- data-loss: drops Job.priority; every job's stored LOW/MEDIUM/HIGH value is destroyed. The field was removed from the UI (#375) and is no longer read or written by the API.
--
-- Only the `Job` column goes. The `JobPriority` enum type stays: it is still
-- used by `companies.priority`, which the companies UI keeps.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX for
-- the five raw indexes that are not represented in schema.prisma (the functional
-- unique index on companies (userId, lower(name)) and the four pg_trgm GIN
-- indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "Job"
  DROP COLUMN "priority";
