-- CreateTable
CREATE TABLE "public"."OrganizationMode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "accessFieldLabel" TEXT,

    CONSTRAINT "OrganizationMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationModePreset" (
    "id" TEXT NOT NULL,
    "orgModeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "OrganizationModePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationAccessField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "OrganizationAccessField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationAccessPreset" (
    "id" TEXT NOT NULL,
    "accessFieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "OrganizationAccessPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationMode_orgId_active_idx" ON "public"."OrganizationMode"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMode_orgId_slot_key" ON "public"."OrganizationMode"("orgId", "slot");

-- CreateIndex
CREATE INDEX "OrganizationModePreset_orgModeId_idx" ON "public"."OrganizationModePreset"("orgModeId");

-- CreateIndex
CREATE INDEX "OrganizationAccessField_orgId_idx" ON "public"."OrganizationAccessField"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAccessField_orgId_key_key" ON "public"."OrganizationAccessField"("orgId", "key");

-- CreateIndex
CREATE INDEX "OrganizationAccessPreset_accessFieldId_idx" ON "public"."OrganizationAccessPreset"("accessFieldId");

-- AddForeignKey
ALTER TABLE "public"."OrganizationModePreset" ADD CONSTRAINT "OrganizationModePreset_orgModeId_fkey" FOREIGN KEY ("orgModeId") REFERENCES "public"."OrganizationMode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationAccessPreset" ADD CONSTRAINT "OrganizationAccessPreset_accessFieldId_fkey" FOREIGN KEY ("accessFieldId") REFERENCES "public"."OrganizationAccessField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
