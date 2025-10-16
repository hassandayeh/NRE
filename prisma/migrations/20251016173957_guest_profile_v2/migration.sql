-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateTable
CREATE TABLE "GuestProfileV2" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "localName" TEXT,
    "pronouns" TEXT,
    "timezone" TEXT NOT NULL,
    "city" TEXT,
    "countryCode" TEXT NOT NULL,
    "languages" TEXT[],
    "regions" TEXT[],
    "topics" TEXT[],
    "formatsTv" BOOLEAN NOT NULL DEFAULT true,
    "formatsRadio" BOOLEAN NOT NULL DEFAULT true,
    "formatsOnline" BOOLEAN NOT NULL DEFAULT true,
    "formatsPhone" BOOLEAN NOT NULL DEFAULT true,
    "bio" TEXT,
    "links" TEXT[],
    "additionalEmails" TEXT[],
    "phone" TEXT,
    "feeNote" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "inviteable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestProfileV2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfileV2_userId_key" ON "GuestProfileV2"("userId");

-- CreateIndex
CREATE INDEX "GuestProfileV2_userId_idx" ON "GuestProfileV2"("userId");

-- CreateIndex
CREATE INDEX "GuestProfileV2_countryCode_idx" ON "GuestProfileV2"("countryCode");

-- AddForeignKey
ALTER TABLE "GuestProfileV2" ADD CONSTRAINT "GuestProfileV2_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
