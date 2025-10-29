-- Backfill programName from subject for legacy rows
UPDATE "Booking"
SET "programName" = "subject"
WHERE "programName" IS NULL AND "subject" IS NOT NULL;

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "subject";
