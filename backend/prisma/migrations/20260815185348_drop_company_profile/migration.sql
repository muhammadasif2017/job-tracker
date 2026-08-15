/*
  Warnings:

  - You are about to drop the `company_profiles` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "company_profiles" DROP CONSTRAINT "company_profiles_jobId_fkey";

-- DropTable
DROP TABLE "company_profiles";
