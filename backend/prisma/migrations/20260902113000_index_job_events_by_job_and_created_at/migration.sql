-- DropIndex
DROP INDEX "job_events_jobId_idx";

-- CreateIndex
CREATE INDEX "job_events_jobId_createdAt_idx" ON "job_events"("jobId", "createdAt");
