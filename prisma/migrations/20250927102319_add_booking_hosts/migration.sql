-- CreateTable
CREATE TABLE "public"."BookingHost" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "appearanceType" "public"."AppearanceType" NOT NULL DEFAULT 'ONLINE',
    "joinUrl" TEXT,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "dialInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingHost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingHost_bookingId_order_idx" ON "public"."BookingHost"("bookingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BookingHost_bookingId_userId_key" ON "public"."BookingHost"("bookingId", "userId");

-- AddForeignKey
ALTER TABLE "public"."BookingHost" ADD CONSTRAINT "BookingHost_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingHost" ADD CONSTRAINT "BookingHost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
