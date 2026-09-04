-- Restore `cultureSummary` on `companies`, dropped in
-- 20260905120000_drop_company_location_and_culture_fields.
--
-- Reinstated on its own: the location fields (`headquarters`, `address`) and
-- their two `*LowConfidence` guard flags stay dropped, as does
-- `workLifeBalance`. Only the culture prose comes back — it carries context
-- (team structure, pace, engineering norms) that `workPolicy`'s
-- Remote/Hybrid/On-site enum cannot express.
--
-- The column arrives empty: the earlier DROP COLUMN already took effect in
-- production, so every existing company reads null until enrichment re-runs.
-- Deliberately not backfilled — the values were LLM-derived, not
-- user-authored, and are regenerable by re-running enrichment.
--
-- Hand-written rather than generated: `prisma migrate dev` emits DROP INDEX
-- for the five raw indexes that are not represented in schema.prisma (the
-- functional unique index on companies (userId, lower(name)) and the four
-- pg_trgm GIN indexes on jobs). See backend/CLAUDE.md, "Prisma 7 Quirks".
ALTER TABLE "companies"
  ADD COLUMN "cultureSummary" TEXT;
