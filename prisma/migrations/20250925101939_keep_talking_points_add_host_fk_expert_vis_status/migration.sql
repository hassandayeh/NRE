-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "hostUserId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_hostUserId_idx" ON "public"."Booking"("hostUserId");

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
