-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('LINKEDIN', 'INDEED', 'ROZEE', 'COMPANY_WEBSITE', 'REFERRAL', 'OTHER');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "source" "JobSource";
