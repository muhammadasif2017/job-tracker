-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('LINKEDIN', 'LINKEDIN_JOBS', 'GOOGLE_SEARCH', 'INDEED', 'ROZEE', 'REFERRAL', 'CAREER_EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicationChannel" AS ENUM ('COMPANY_WEBSITE', 'ATS', 'LINKEDIN', 'INDEED', 'ROZEE', 'REFERRAL', 'CAREER_EMAIL', 'OTHER');

-- AlterTable: add new columns first, keep "source" around for the backfill below
ALTER TABLE "Job"
  ADD COLUMN     "applicationChannel" "ApplicationChannel",
  ADD COLUMN     "discoverySource" "DiscoverySource";

-- Backfill: copy existing "source" into both new fields, best-effort mapping
-- (same member name where it exists in the target enum, else OTHER)
UPDATE "Job" SET "discoverySource" = CASE "source"
  WHEN 'LINKEDIN' THEN 'LINKEDIN'::"DiscoverySource"
  WHEN 'INDEED' THEN 'INDEED'::"DiscoverySource"
  WHEN 'ROZEE' THEN 'ROZEE'::"DiscoverySource"
  WHEN 'REFERRAL' THEN 'REFERRAL'::"DiscoverySource"
  WHEN 'CAREER_EMAIL' THEN 'CAREER_EMAIL'::"DiscoverySource"
  ELSE 'OTHER'::"DiscoverySource"
END WHERE "source" IS NOT NULL;

UPDATE "Job" SET "applicationChannel" = CASE "source"
  WHEN 'COMPANY_WEBSITE' THEN 'COMPANY_WEBSITE'::"ApplicationChannel"
  WHEN 'LINKEDIN' THEN 'LINKEDIN'::"ApplicationChannel"
  WHEN 'INDEED' THEN 'INDEED'::"ApplicationChannel"
  WHEN 'ROZEE' THEN 'ROZEE'::"ApplicationChannel"
  WHEN 'REFERRAL' THEN 'REFERRAL'::"ApplicationChannel"
  WHEN 'CAREER_EMAIL' THEN 'CAREER_EMAIL'::"ApplicationChannel"
  ELSE 'OTHER'::"ApplicationChannel"
END WHERE "source" IS NOT NULL;

-- AlterTable: now drop the old column
ALTER TABLE "Job" DROP COLUMN "source";

-- DropEnum
DROP TYPE "JobSource";
