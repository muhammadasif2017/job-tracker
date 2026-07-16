-- Rename preserves existing enrichment data (plain drop/add would lose it)
ALTER TABLE "company_profiles" RENAME COLUMN "remotePolicy" TO "workPolicy";
