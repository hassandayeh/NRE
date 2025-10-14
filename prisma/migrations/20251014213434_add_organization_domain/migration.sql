-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVOKED');

-- CreateTable
CREATE TABLE "OrganizationDomain" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "domain" VARCHAR(320) NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'VERIFIED',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissionKeyId" TEXT,

    CONSTRAINT "OrganizationDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationDomain_domain_idx" ON "OrganizationDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationDomain_orgId_domain_key" ON "OrganizationDomain"("orgId", "domain");

-- AddForeignKey
ALTER TABLE "OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationDomain" ADD CONSTRAINT "OrganizationDomain_permissionKeyId_fkey" FOREIGN KEY ("permissionKeyId") REFERENCES "PermissionKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
