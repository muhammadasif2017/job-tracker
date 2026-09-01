-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "timelineSummary" TEXT,
ADD COLUMN     "timelineSummaryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "interview_rounds" ADD COLUMN     "prepGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "prepSuggestions" TEXT;
