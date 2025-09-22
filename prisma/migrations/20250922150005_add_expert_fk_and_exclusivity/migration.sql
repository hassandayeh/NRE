/*
  Warnings:

  - The values [DEV] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `OrgFeatureToggle` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."ExpertStatus" AS ENUM ('PUBLIC', 'EXCLUSIVE');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."Role_new" AS ENUM ('OWNER', 'ADMIN', 'PRODUCER', 'EXPERT');
ALTER TABLE "public"."OrganizationMembership" ALTER COLUMN "role" TYPE "public"."Role_new" USING ("role"::text::"public"."Role_new");
ALTER TYPE "public"."Role" RENAME TO "Role_old";
ALTER TYPE "public"."Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."OrgFeatureToggle" DROP CONSTRAINT "OrgFeatureToggle_orgId_fkey";

-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "expertUserId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "exclusiveOrgId" TEXT,
ADD COLUMN     "expertStatus" "public"."ExpertStatus" DEFAULT 'PUBLIC';

-- DropTable
DROP TABLE "public"."OrgFeatureToggle";

-- CreateIndex
CREATE INDEX "Booking_expertUserId_idx" ON "public"."Booking"("expertUserId");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_exclusiveOrgId_fkey" FOREIGN KEY ("exclusiveOrgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_expertUserId_fkey" FOREIGN KEY ("expertUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
