-- CreateTable
CREATE TABLE "public"."OrganizationModePreset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationModePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationAccessField" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationAccessField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationAccessPreset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "modeSlot" INTEGER NOT NULL,
    "fieldId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationAccessPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationModePreset_orgId_idx" ON "public"."OrganizationModePreset"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationModePreset_orgId_slot_key" ON "public"."OrganizationModePreset"("orgId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAccessField_key_key" ON "public"."OrganizationAccessField"("key");

-- CreateIndex
CREATE INDEX "OrganizationAccessPreset_orgId_idx" ON "public"."OrganizationAccessPreset"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAccessPreset_orgId_modeSlot_fieldId_key" ON "public"."OrganizationAccessPreset"("orgId", "modeSlot", "fieldId");

-- AddForeignKey
ALTER TABLE "public"."OrganizationModePreset" ADD CONSTRAINT "OrganizationModePreset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "public"."OrganizationAccessField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
