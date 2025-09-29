-- CreateEnum
CREATE TYPE "public"."BookingParticipantRole" AS ENUM ('HOST', 'EXPERT', 'REPORTER', 'INTERPRETER');

-- CreateEnum
CREATE TYPE "public"."InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."BookingParticipant" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "public"."BookingParticipantRole" NOT NULL,
    "inviteStatus" "public"."InviteStatus" NOT NULL DEFAULT 'PENDING',
    "isPrimaryHost" BOOLEAN NOT NULL DEFAULT false,
    "invitedByUserId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingParticipant_bookingId_idx" ON "public"."BookingParticipant"("bookingId");

-- CreateIndex
CREATE INDEX "BookingParticipant_userId_inviteStatus_idx" ON "public"."BookingParticipant"("userId", "inviteStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BookingParticipant_bookingId_userId_role_key" ON "public"."BookingParticipant"("bookingId", "userId", "role");

-- AddForeignKey
ALTER TABLE "public"."BookingParticipant" ADD CONSTRAINT "BookingParticipant_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingParticipant" ADD CONSTRAINT "BookingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
