-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "industry" TEXT,
    "companySize" TEXT,
    "techStack" TEXT[],
    "cultureSummary" TEXT,
    "remotePolicy" TEXT,
    "workLifeBalance" TEXT,
    "headquarters" TEXT,
    "founded" TEXT,
    "errorMessage" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_jobId_key" ON "company_profiles"("jobId");

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
