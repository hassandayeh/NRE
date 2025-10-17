/*
  Warnings:

  - You are about to drop the column `headshotUrl` on the `GuestProfile` table. All the data in the column will be lost.
  - You are about to alter the column `personalEmail` on the `GuestProfile` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(320)`.
  - You are about to drop the `GuestProfileV2` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "Honorific" AS ENUM ('DR', 'PROF', 'ENG', 'MR', 'MS', 'MRS', 'AMB', 'GEN', 'OTHER');

-- CreateEnum
CREATE TYPE "Pronouns" AS ENUM ('SHE_HER', 'HE_HIM', 'THEY_THEM', 'SELF_DESCRIBE', 'PREFER_NOT');

-- CreateEnum
CREATE TYPE "CEFRLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "TravelReadiness" AS ENUM ('LOCAL', 'REGIONAL', 'GLOBAL');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('TV', 'RADIO', 'ONLINE', 'PRINT', 'PODCAST');

-- CreateEnum
CREATE TYPE "ContactVisibility" AS ENUM ('PUBLIC', 'INTERNAL', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('PHONE', 'WHATSAPP', 'TELEGRAM', 'SIGNAL', 'WECHAT', 'IM', 'OTHER');

-- AlterTable
ALTER TABLE "GuestProfile" DROP COLUMN "headshotUrl",
ADD COLUMN     "appearanceTypes" "AppearanceType"[] DEFAULT ARRAY[]::"AppearanceType"[],
ADD COLUMN     "city" VARCHAR(200),
ADD COLUMN     "countryCode" VARCHAR(2),
ADD COLUMN     "fullBio" TEXT,
ADD COLUMN     "headline" VARCHAR(120),
ADD COLUMN     "honorific" "Honorific",
ADD COLUMN     "nativeName" VARCHAR(200),
ADD COLUMN     "pronouns" "Pronouns",
ADD COLUMN     "regionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shortBio" VARCHAR(280),
ADD COLUMN     "timezone" VARCHAR(64),
ADD COLUMN     "topicKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "travelReadiness" "TravelReadiness",
ALTER COLUMN "personalEmail" SET DATA TYPE VARCHAR(320);

-- DropTable
DROP TABLE "public"."GuestProfileV2";

-- DropEnum
DROP TYPE "public"."Visibility";

-- CreateTable
CREATE TABLE "GuestLanguage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "isoCode" VARCHAR(16) NOT NULL,
    "level" "CEFRLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestExperience" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "orgName" VARCHAR(200) NOT NULL,
    "roleTitle" VARCHAR(200),
    "from" TIMESTAMP(3),
    "to" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestEducation" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "institution" VARCHAR(200) NOT NULL,
    "credential" VARCHAR(200),
    "fieldOfStudy" VARCHAR(200),
    "from" TIMESTAMP(3),
    "to" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestPublication" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "outlet" VARCHAR(200),
    "year" INTEGER,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestMediaAppearance" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "outlet" VARCHAR(200),
    "date" TIMESTAMP(3),
    "url" TEXT,
    "type" "MediaType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestMediaAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestAdditionalEmail" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "visibility" "ContactVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestAdditionalEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestContactMethod" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "visibility" "ContactVisibility" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestContactMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestLanguage_profileId_idx" ON "GuestLanguage"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestLanguage_profileId_isoCode_key" ON "GuestLanguage"("profileId", "isoCode");

-- CreateIndex
CREATE INDEX "GuestExperience_profileId_isCurrent_idx" ON "GuestExperience"("profileId", "isCurrent");

-- CreateIndex
CREATE INDEX "GuestEducation_profileId_idx" ON "GuestEducation"("profileId");

-- CreateIndex
CREATE INDEX "GuestPublication_profileId_year_idx" ON "GuestPublication"("profileId", "year");

-- CreateIndex
CREATE INDEX "GuestMediaAppearance_profileId_date_idx" ON "GuestMediaAppearance"("profileId", "date");

-- CreateIndex
CREATE INDEX "GuestAdditionalEmail_profileId_visibility_idx" ON "GuestAdditionalEmail"("profileId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "GuestAdditionalEmail_profileId_email_key" ON "GuestAdditionalEmail"("profileId", "email");

-- CreateIndex
CREATE INDEX "GuestContactMethod_profileId_type_idx" ON "GuestContactMethod"("profileId", "type");

-- AddForeignKey
ALTER TABLE "GuestLanguage" ADD CONSTRAINT "GuestLanguage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestExperience" ADD CONSTRAINT "GuestExperience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestEducation" ADD CONSTRAINT "GuestEducation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPublication" ADD CONSTRAINT "GuestPublication_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestMediaAppearance" ADD CONSTRAINT "GuestMediaAppearance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestAdditionalEmail" ADD CONSTRAINT "GuestAdditionalEmail_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestContactMethod" ADD CONSTRAINT "GuestContactMethod_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
