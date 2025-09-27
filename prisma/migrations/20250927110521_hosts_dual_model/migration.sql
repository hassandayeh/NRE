-- CreateEnum
CREATE TYPE "public"."HostAppearanceScope" AS ENUM ('UNIFIED', 'PER_HOST');

-- CreateEnum
CREATE TYPE "public"."HostAccessProvisioning" AS ENUM ('SHARED', 'PER_HOST');

-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "hostAccessProvisioning" "public"."HostAccessProvisioning" NOT NULL DEFAULT 'SHARED',
ADD COLUMN     "hostAppearanceScope" "public"."HostAppearanceScope" NOT NULL DEFAULT 'UNIFIED',
ADD COLUMN     "hostAppearanceType" "public"."AppearanceType",
ADD COLUMN     "hostDialInfo" TEXT,
ADD COLUMN     "hostLocationAddress" TEXT,
ADD COLUMN     "hostLocationName" VARCHAR(300),
ADD COLUMN     "hostLocationUrl" TEXT;
