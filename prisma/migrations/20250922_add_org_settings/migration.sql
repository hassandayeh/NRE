-- prisma/migrations/20250922_add_org_settings/migration.sql
-- Create OrgSettings table and FK to Organization (PostgreSQL)

CREATE TABLE "OrgSettings" (
  "id" TEXT PRIMARY KEY,
  "orgId" TEXT NOT NULL UNIQUE,
  "showProgramName" BOOLEAN NOT NULL DEFAULT TRUE,
  "showHostName" BOOLEAN NOT NULL DEFAULT TRUE,
  "showTalkingPoints" BOOLEAN NOT NULL DEFAULT TRUE,
  "allowInPerson" BOOLEAN NOT NULL DEFAULT TRUE,
  "allowOnline" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "OrgSettings"
  ADD CONSTRAINT "OrgSettings_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
