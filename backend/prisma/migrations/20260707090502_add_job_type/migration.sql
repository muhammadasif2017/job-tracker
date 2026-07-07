-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "jobType" "JobType" NOT NULL DEFAULT 'ONSITE';
