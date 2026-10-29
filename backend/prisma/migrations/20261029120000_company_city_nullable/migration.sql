-- data-loss: drops the companies_userId_city_idx index only; no row or column data is lost. Postgres can rebuild the index from the column at any time.
--
-- Makes companies.city nullable and drops its index. The API no longer reads
-- or writes it: the office `location` already carries the address, city
-- included. New rows get NULL; existing rows keep their value until a later
-- release drops the column and the CompanyCity enum. The column stays for now
-- because the previous release still writes it while both containers run
-- (ADR-057).
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX for
-- the five raw indexes that are not represented in schema.prisma (the functional
-- unique index on companies (userId, lower(name)) and the four pg_trgm GIN
-- indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".

-- Nothing filters on city any more. The previous release's city filter still
-- works without the index while both containers run.
DROP INDEX "companies_userId_city_idx";

ALTER TABLE "companies" ALTER COLUMN "city" DROP NOT NULL;
