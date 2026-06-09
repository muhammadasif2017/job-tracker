-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");

-- CreateIndex
CREATE INDEX "Job_userId_status_idx" ON "Job"("userId", "status");

-- CreateIndex
CREATE INDEX "Job_userId_appliedAt_idx" ON "Job"("userId", "appliedAt");

-- CreateIndex
CREATE INDEX "job_events_jobId_idx" ON "job_events"("jobId");
