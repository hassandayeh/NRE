-- CreateEnum
CREATE TYPE "public"."BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AppearanceType" AS ENUM ('IN_PERSON', 'ONLINE', 'PHONE');

-- CreateEnum
CREATE TYPE "public"."InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."Organization" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "hashedPassword" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(200),
    "avatarUrl" TEXT,
    "bio" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportsOnline" BOOLEAN NOT NULL DEFAULT false,
    "supportsInPerson" BOOLEAN NOT NULL DEFAULT false,
    "city" VARCHAR(200),
    "countryCode" VARCHAR(2),
    "timeZone" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PermissionKey" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoleTemplate" (
    "id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "defaultLabel" VARCHAR(100) NOT NULL,
    "isActiveByDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoleTemplatePermission" (
    "roleTemplateId" TEXT NOT NULL,
    "permissionKeyId" TEXT NOT NULL,

    CONSTRAINT "RoleTemplatePermission_pkey" PRIMARY KEY ("roleTemplateId","permissionKeyId")
);

-- CreateTable
CREATE TABLE "public"."OrgRole" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgRolePermission" (
    "orgRoleId" TEXT NOT NULL,
    "permissionKeyId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OrgRolePermission_pkey" PRIMARY KEY ("orgRoleId","permissionKeyId")
);

-- CreateTable
CREATE TABLE "public"."UserRole" (
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","orgId")
);

-- CreateTable
CREATE TABLE "public"."Booking" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "status" "public"."BookingStatus" NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "appearanceType" "public"."AppearanceType",
    "locationUrl" TEXT,
    "locationName" VARCHAR(300),
    "locationAddress" TEXT,
    "dialInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingParticipant" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "roleSlot" INTEGER NOT NULL,
    "roleLabelSnapshot" VARCHAR(100),
    "inviteStatus" "public"."InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingParticipant_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "Organization_name_idx" ON "public"."Organization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_displayName_idx" ON "public"."User"("displayName");

-- CreateIndex
CREATE INDEX "User_countryCode_idx" ON "public"."User"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionKey_key_key" ON "public"."PermissionKey"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RoleTemplate_slot_key" ON "public"."RoleTemplate"("slot");

-- CreateIndex
CREATE INDEX "OrgRole_orgId_idx" ON "public"."OrgRole"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRole_orgId_slot_key" ON "public"."OrgRole"("orgId", "slot");

-- CreateIndex
CREATE INDEX "UserRole_orgId_slot_idx" ON "public"."UserRole"("orgId", "slot");

-- CreateIndex
CREATE INDEX "Booking_orgId_idx" ON "public"."Booking"("orgId");

-- CreateIndex
CREATE INDEX "Booking_startAt_idx" ON "public"."Booking"("startAt");

-- CreateIndex
CREATE INDEX "BookingParticipant_bookingId_idx" ON "public"."BookingParticipant"("bookingId");

-- CreateIndex
CREATE INDEX "BookingParticipant_roleSlot_idx" ON "public"."BookingParticipant"("roleSlot");

-- CreateIndex
CREATE INDEX "BookingParticipant_userId_inviteStatus_idx" ON "public"."BookingParticipant"("userId", "inviteStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BookingParticipant_bookingId_userId_key" ON "public"."BookingParticipant"("bookingId", "userId");

-- CreateIndex
CREATE INDEX "BookingNote_bookingId_createdAt_idx" ON "public"."BookingNote"("bookingId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."RoleTemplatePermission" ADD CONSTRAINT "RoleTemplatePermission_roleTemplateId_fkey" FOREIGN KEY ("roleTemplateId") REFERENCES "public"."RoleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoleTemplatePermission" ADD CONSTRAINT "RoleTemplatePermission_permissionKeyId_fkey" FOREIGN KEY ("permissionKeyId") REFERENCES "public"."PermissionKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgRole" ADD CONSTRAINT "OrgRole_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgRolePermission" ADD CONSTRAINT "OrgRolePermission_orgRoleId_fkey" FOREIGN KEY ("orgRoleId") REFERENCES "public"."OrgRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgRolePermission" ADD CONSTRAINT "OrgRolePermission_permissionKeyId_fkey" FOREIGN KEY ("permissionKeyId") REFERENCES "public"."PermissionKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserRole" ADD CONSTRAINT "UserRole_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserRole" ADD CONSTRAINT "UserRole_orgId_slot_fkey" FOREIGN KEY ("orgId", "slot") REFERENCES "public"."OrgRole"("orgId", "slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingParticipant" ADD CONSTRAINT "BookingParticipant_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingParticipant" ADD CONSTRAINT "BookingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingNote" ADD CONSTRAINT "BookingNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingNote" ADD CONSTRAINT "BookingNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
