-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Backfill any existing rows (created before this column existed) to
-- createdAt + 180 days so the column can be made required.
UPDATE "ApiToken" SET "expiresAt" = "createdAt" + INTERVAL '180 days' WHERE "expiresAt" IS NULL;

-- AlterTable
ALTER TABLE "ApiToken" ALTER COLUMN "expiresAt" SET NOT NULL;
