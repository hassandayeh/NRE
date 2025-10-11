-- CreateTable
CREATE TABLE "GuestProfile" (
    "id" TEXT NOT NULL,
    "personalEmail" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "inviteable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuestProfile_personalEmail_key" ON "GuestProfile"("personalEmail");
