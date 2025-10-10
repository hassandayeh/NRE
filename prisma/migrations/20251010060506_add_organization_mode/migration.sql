-- CreateTable
CREATE TABLE "public"."OrganizationMode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationMode_orgId_idx" ON "public"."OrganizationMode"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMode_orgId_slot_key" ON "public"."OrganizationMode"("orgId", "slot");

-- AddForeignKey
ALTER TABLE "public"."OrganizationMode" ADD CONSTRAINT "OrganizationMode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
