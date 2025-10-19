-- CreateTable
CREATE TABLE "OrgGuestNote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgGuestNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgGuestNote_orgId_guestId_createdAt_idx" ON "OrgGuestNote"("orgId", "guestId", "createdAt");
