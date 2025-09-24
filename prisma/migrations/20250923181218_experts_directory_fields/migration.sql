/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "public"."OrgSettings" ADD COLUMN     "defaultDurationMins" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "minLeadTimeMins" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "city" VARCHAR(120),
ADD COLUMN     "countryCode" VARCHAR(2),
ADD COLUMN     "inPersonRadiusKm" INTEGER,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rankBoost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "slug" VARCHAR(120),
ADD COLUMN     "supportsInPerson" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supportsOnline" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "public"."ExpertTimeBlock" (
    "id" TEXT NOT NULL,
    "expertUserId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertTimeBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpertTimeBlock_expertUserId_startAt_idx" ON "public"."ExpertTimeBlock"("expertUserId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_createdByUserId_idx" ON "public"."Booking"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_slug_key" ON "public"."User"("slug");

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpertTimeBlock" ADD CONSTRAINT "ExpertTimeBlock_expertUserId_fkey" FOREIGN KEY ("expertUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
