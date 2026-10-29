-- data-loss: drops companies.city and the CompanyCity enum; every company's stored city (LAHORE/ISLAMABAD/KARACHI/OTHER) is destroyed. The field was removed from the UI and the API in #539 and is no longer read or written, and the office `location` carries the address instead.
--
-- Second of two releases (ADR-057). The previous release made the column
-- nullable, dropped its index and @ignore'd it in the Prisma client, so the
-- old container never touches it while both run.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX for
-- the five raw indexes that are not represented in schema.prisma (the functional
-- unique index on companies (userId, lower(name)) and the four pg_trgm GIN
-- indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "companies" DROP COLUMN "city";

DROP TYPE "CompanyCity";
