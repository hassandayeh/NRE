/*
  Warnings:

  - You are about to drop the column `guestProfileId` on the `BookingParticipant` table. All the data in the column will be lost.
  - You are about to drop the column `staffOrgId` on the `BookingParticipant` table. All the data in the column will be lost.
  - You are about to drop the column `staffUserId` on the `BookingParticipant` table. All the data in the column will be lost.
  - You are about to drop the `GuestProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OrganizationAccessField` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OrganizationAccessPreset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OrganizationMode` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OrganizationModePreset` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."BookingParticipant" DROP CONSTRAINT "BookingParticipant_guestProfileId_fkey";

-- DropForeignKey
ALTER TABLE "public"."BookingParticipant" DROP CONSTRAINT "BookingParticipant_staffUserId_staffOrgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."GuestProfile" DROP CONSTRAINT "GuestProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" DROP CONSTRAINT "OrganizationAccessPreset_accessFieldId_fkey";

-- DropForeignKey
ALTER TABLE "public"."OrganizationModePreset" DROP CONSTRAINT "OrganizationModePreset_orgModeId_fkey";

-- DropIndex
DROP INDEX "public"."BookingParticipant_bookingId_guestProfileId_key";

-- DropIndex
DROP INDEX "public"."BookingParticipant_bookingId_staffUserId_staffOrgId_key";

-- DropIndex
DROP INDEX "public"."BookingParticipant_guestProfileId_idx";

-- DropIndex
DROP INDEX "public"."BookingParticipant_staffUserId_staffOrgId_idx";

-- AlterTable
ALTER TABLE "public"."BookingParticipant" DROP COLUMN "guestProfileId",
DROP COLUMN "staffOrgId",
DROP COLUMN "staffUserId";

-- AlterTable
ALTER TABLE "public"."UserRole" ALTER COLUMN "orgManaged" SET DEFAULT false;

-- DropTable
DROP TABLE "public"."GuestProfile";

-- DropTable
DROP TABLE "public"."OrganizationAccessField";

-- DropTable
DROP TABLE "public"."OrganizationAccessPreset";

-- DropTable
DROP TABLE "public"."OrganizationMode";

-- DropTable
DROP TABLE "public"."OrganizationModePreset";

-- DropEnum
DROP TYPE "public"."GuestVisibility";
