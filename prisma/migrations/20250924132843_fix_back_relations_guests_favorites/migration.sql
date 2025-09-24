/*
  Warnings:

  - You are about to drop the column `createdByUserId` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `defaultDurationMins` on the `OrgSettings` table. All the data in the column will be lost.
  - You are about to drop the column `minLeadTimeMins` on the `OrgSettings` table. All the data in the column will be lost.
  - You are about to drop the column `avatarUrl` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `bio` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `countryCode` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `inPersonRadiusKm` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `languages` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `rankBoost` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `supportsInPerson` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `supportsOnline` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `ExpertTimeBlock` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."AppearanceScope" AS ENUM ('UNIFIED', 'PER_GUEST');

-- CreateEnum
CREATE TYPE "public"."AccessProvisioning" AS ENUM ('SHARED', 'PER_GUEST');

-- CreateEnum
CREATE TYPE "public"."ParticipantKind" AS ENUM ('EXPERT', 'REPORTER');

-- AlterEnum
ALTER TYPE "public"."AppearanceType" ADD VALUE 'PHONE';

-- AlterEnum
ALTER TYPE "public"."Role" ADD VALUE 'HOST';

-- DropForeignKey
ALTER TABLE "public"."Booking" DROP CONSTRAINT "Booking_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ExpertTimeBlock" DROP CONSTRAINT "ExpertTimeBlock_expertUserId_fkey";

-- DropIndex
DROP INDEX "public"."Booking_createdByUserId_idx";

-- DropIndex
DROP INDEX "public"."User_slug_key";

-- AlterTable
ALTER TABLE "public"."Booking" DROP COLUMN "createdByUserId",
ADD COLUMN     "accessProvisioning" "public"."AccessProvisioning" NOT NULL DEFAULT 'SHARED',
ADD COLUMN     "appearanceScope" "public"."AppearanceScope" NOT NULL DEFAULT 'UNIFIED',
ADD COLUMN     "dialInfo" TEXT,
ADD COLUMN     "locationAddress" TEXT,
ALTER COLUMN "appearanceType" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."OrgSettings" DROP COLUMN "defaultDurationMins",
DROP COLUMN "minLeadTimeMins";

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "avatarUrl",
DROP COLUMN "bio",
DROP COLUMN "city",
DROP COLUMN "countryCode",
DROP COLUMN "inPersonRadiusKm",
DROP COLUMN "languages",
DROP COLUMN "rankBoost",
DROP COLUMN "slug",
DROP COLUMN "supportsInPerson",
DROP COLUMN "supportsOnline",
DROP COLUMN "tags",
DROP COLUMN "timezone";

-- DropTable
DROP TABLE "public"."ExpertTimeBlock";

-- CreateTable
CREATE TABLE "public"."BookingGuest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "public"."ParticipantKind" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "appearanceType" "public"."AppearanceType" NOT NULL,
    "joinUrl" TEXT,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "dialInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingNote" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FavoriteList" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavoriteList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FavoriteListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FavoriteListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingGuest_bookingId_order_idx" ON "public"."BookingGuest"("bookingId", "order");

-- CreateIndex
CREATE INDEX "BookingGuest_bookingId_kind_idx" ON "public"."BookingGuest"("bookingId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BookingGuest_bookingId_userId_key" ON "public"."BookingGuest"("bookingId", "userId");

-- CreateIndex
CREATE INDEX "BookingNote_bookingId_createdAt_idx" ON "public"."BookingNote"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "FavoriteList_orgId_name_idx" ON "public"."FavoriteList"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteListItem_listId_targetUserId_key" ON "public"."FavoriteListItem"("listId", "targetUserId");

-- AddForeignKey
ALTER TABLE "public"."BookingGuest" ADD CONSTRAINT "BookingGuest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingGuest" ADD CONSTRAINT "BookingGuest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingNote" ADD CONSTRAINT "BookingNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingNote" ADD CONSTRAINT "BookingNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FavoriteList" ADD CONSTRAINT "FavoriteList_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FavoriteList" ADD CONSTRAINT "FavoriteList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FavoriteListItem" ADD CONSTRAINT "FavoriteListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "public"."FavoriteList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FavoriteListItem" ADD CONSTRAINT "FavoriteListItem_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
