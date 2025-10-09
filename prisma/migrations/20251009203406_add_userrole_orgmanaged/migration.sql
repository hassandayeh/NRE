/*
  Warnings:

  - A unique constraint covering the columns `[bookingId,staffUserId,staffOrgId]` on the table `BookingParticipant` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[bookingId,guestProfileId]` on the table `BookingParticipant` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."GuestVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "public"."BookingParticipant" ADD COLUMN     "guestProfileId" TEXT,
ADD COLUMN     "staffOrgId" TEXT,
ADD COLUMN     "staffUserId" TEXT;

-- AlterTable
ALTER TABLE "public"."UserRole" ADD COLUMN     "orgManaged" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "public"."GuestProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personalEmail" VARCHAR(320) NOT NULL,
    "visibility" "public"."GuestVisibility" NOT NULL DEFAULT 'PRIVATE',
    "inviteable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfile_userId_key" ON "public"."GuestProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfile_personalEmail_key" ON "public"."GuestProfile"("personalEmail");

-- CreateIndex
CREATE INDEX "GuestProfile_visibility_idx" ON "public"."GuestProfile"("visibility");

-- CreateIndex
CREATE INDEX "GuestProfile_inviteable_idx" ON "public"."GuestProfile"("inviteable");

-- CreateIndex
CREATE INDEX "BookingParticipant_staffUserId_staffOrgId_idx" ON "public"."BookingParticipant"("staffUserId", "staffOrgId");

-- CreateIndex
CREATE INDEX "BookingParticipant_guestProfileId_idx" ON "public"."BookingParticipant"("guestProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingParticipant_bookingId_staffUserId_staffOrgId_key" ON "public"."BookingParticipant"("bookingId", "staffUserId", "staffOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingParticipant_bookingId_guestProfileId_key" ON "public"."BookingParticipant"("bookingId", "guestProfileId");

-- AddForeignKey
ALTER TABLE "public"."GuestProfile" ADD CONSTRAINT "GuestProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingParticipant" ADD CONSTRAINT "BookingParticipant_staffUserId_staffOrgId_fkey" FOREIGN KEY ("staffUserId", "staffOrgId") REFERENCES "public"."UserRole"("userId", "orgId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingParticipant" ADD CONSTRAINT "BookingParticipant_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "public"."GuestProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
