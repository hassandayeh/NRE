-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "city" VARCHAR(200),
ADD COLUMN     "countryCode" VARCHAR(2),
ADD COLUMN     "supportsInPerson" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "User_name_idx" ON "public"."User"("name");

-- CreateIndex
CREATE INDEX "User_countryCode_idx" ON "public"."User"("countryCode");

-- CreateIndex
CREATE INDEX "User_displayName_idx" ON "public"."User"("displayName");
