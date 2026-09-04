-- Drop five low-value enrichment columns from `companies`.
--
-- `address` and `headquarters` were the only two fields carrying a confidence
-- guard, so dropping both retires the whole guard subsystem with them (the
-- token-overlap check, the two `*LowConfidence` flags, the address-only prompt
-- hardening, and the low-confidence badge UI). Neither survived the
-- redundancy test: `city` (indexed, filterable) and `location` (the enrichment
-- disambiguation anchor) already carry the location signal this list needs.
--
-- `cultureSummary` goes for the same reason `workLifeBalance` did — LLM prose
-- with no reliable source for private Pakistani companies, overlapping the
-- actionable half of `workPolicy`.
--
-- No data-loss concern: all five are enrichment-derived, not user-authored,
-- and regenerable by re-running enrichment.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX
-- for the five raw indexes that are not represented in schema.prisma (the
-- functional unique index on companies (userId, lower(name)) and the four
-- pg_trgm GIN indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "companies"
  DROP COLUMN "cultureSummary",
  DROP COLUMN "headquarters",
  DROP COLUMN "headquartersLowConfidence",
  DROP COLUMN "address",
  DROP COLUMN "addressLowConfidence";
