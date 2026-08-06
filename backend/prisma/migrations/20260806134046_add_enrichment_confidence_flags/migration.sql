-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "addressLowConfidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "headquartersLowConfidence" BOOLEAN NOT NULL DEFAULT false;
