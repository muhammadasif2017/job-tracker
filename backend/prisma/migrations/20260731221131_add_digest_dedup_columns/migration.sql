-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "staleAppliedDigestedAt" TIMESTAMP(3),
ADD COLUMN     "staleInterviewingDigestedAt" TIMESTAMP(3);
