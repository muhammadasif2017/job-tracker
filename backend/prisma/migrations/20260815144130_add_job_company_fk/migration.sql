-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "Job_companyId_idx" ON "Job"("companyId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
