-- CreateIndex
CREATE INDEX "User_digestFrequency_idx" ON "User"("digestFrequency");

-- CreateIndex
CREATE INDEX "interview_rounds_outcome_scheduledAt_reminderSentAt_idx" ON "interview_rounds"("outcome", "scheduledAt", "reminderSentAt");
