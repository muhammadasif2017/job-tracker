-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "priority" "JobPriority" NOT NULL DEFAULT 'MEDIUM';
