-- CreateEnum
CREATE TYPE "CompanyCity" AS ENUM ('LAHORE', 'ISLAMABAD', 'KARACHI', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessMode" AS ENUM ('PRODUCT', 'SERVICES', 'HYBRID');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "companyId" TEXT,
ALTER COLUMN "jobId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" "CompanyCity" NOT NULL,
    "location" TEXT,
    "priority" "JobPriority" NOT NULL DEFAULT 'MEDIUM',
    "personalNotes" TEXT,
    "websiteUrl" TEXT,
    "linkedinUrl" TEXT,
    "businessMode" "BusinessMode",
    "productDescription" TEXT,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "industry" TEXT,
    "companySize" TEXT,
    "techStack" TEXT[],
    "cultureSummary" TEXT,
    "workPolicy" TEXT,
    "workLifeBalance" TEXT,
    "headquarters" TEXT,
    "headquartersLowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "addressLowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "founded" TEXT,
    "errorMessage" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_userId_idx" ON "companies"("userId");

-- CreateIndex
CREATE INDEX "companies_userId_city_idx" ON "companies"("userId", "city");

-- CreateIndex
CREATE INDEX "companies_userId_priority_idx" ON "companies"("userId", "priority");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
