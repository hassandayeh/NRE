/*
  Warnings:

  - Added the required column `accessFieldId` to the `OrganizationAccessPreset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgModeId` to the `OrganizationAccessPreset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgModeId` to the `OrganizationModePreset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `value` to the `OrganizationModePreset` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" DROP CONSTRAINT "OrganizationAccessPreset_fieldId_fkey";

-- DropForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" DROP CONSTRAINT "OrganizationAccessPreset_orgId_fkey";

-- DropForeignKey
ALTER TABLE "public"."OrganizationModePreset" DROP CONSTRAINT "OrganizationModePreset_orgId_fkey";

-- AlterTable
ALTER TABLE "public"."OrganizationAccessPreset" ADD COLUMN     "accessFieldId" TEXT NOT NULL,
ADD COLUMN     "orgModeId" TEXT NOT NULL,
ADD COLUMN     "value" TEXT,
ALTER COLUMN "orgId" DROP NOT NULL,
ALTER COLUMN "modeSlot" DROP NOT NULL,
ALTER COLUMN "fieldId" DROP NOT NULL,
ALTER COLUMN "allowed" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."OrganizationMode" ADD COLUMN     "accessFieldLabel" TEXT;

-- AlterTable
ALTER TABLE "public"."OrganizationModePreset" ADD COLUMN     "orgModeId" TEXT NOT NULL,
ADD COLUMN     "value" TEXT NOT NULL,
ALTER COLUMN "orgId" DROP NOT NULL,
ALTER COLUMN "slot" DROP NOT NULL,
ALTER COLUMN "label" DROP NOT NULL,
ALTER COLUMN "label" SET DATA TYPE TEXT,
ALTER COLUMN "active" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OrganizationAccessPreset_orgModeId_idx" ON "public"."OrganizationAccessPreset"("orgModeId");

-- CreateIndex
CREATE INDEX "OrganizationAccessPreset_accessFieldId_idx" ON "public"."OrganizationAccessPreset"("accessFieldId");

-- CreateIndex
CREATE INDEX "OrganizationModePreset_orgModeId_idx" ON "public"."OrganizationModePreset"("orgModeId");

-- AddForeignKey
ALTER TABLE "public"."OrganizationModePreset" ADD CONSTRAINT "OrganizationModePreset_orgModeId_fkey" FOREIGN KEY ("orgModeId") REFERENCES "public"."OrganizationMode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationModePreset" ADD CONSTRAINT "OrganizationModePreset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_orgModeId_fkey" FOREIGN KEY ("orgModeId") REFERENCES "public"."OrganizationMode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_accessFieldId_fkey" FOREIGN KEY ("accessFieldId") REFERENCES "public"."OrganizationAccessField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "public"."OrganizationAccessField"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
