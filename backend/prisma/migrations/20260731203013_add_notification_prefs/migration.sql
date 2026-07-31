-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "interviewRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "interview_rounds" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);
