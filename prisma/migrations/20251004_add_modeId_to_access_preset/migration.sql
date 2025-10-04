-- prisma/migrations/20251004_add_modeId_to_access_preset/migration.sql
-- Purpose: allow linking many Access items (presets) to a single Mode
-- Tables referenced already exist in your DB: "OrganizationAccessPreset", "OrganizationMode"

-- 1) Add the column (nullable for a smooth rollout; UI will enforce required link)
ALTER TABLE "OrganizationAccessPreset"
ADD COLUMN IF NOT EXISTS "modeId" TEXT;

-- 2) Index for dependent dropdowns / lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'OrganizationAccessPreset_modeId_idx'
      AND n.nspname = 'public'
  ) THEN
    CREATE INDEX "OrganizationAccessPreset_modeId_idx"
      ON "OrganizationAccessPreset" ("modeId");
  END IF;
END$$;

-- 3) Foreign key -> OrganizationMode(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OrganizationAccessPreset_modeId_fkey'
      AND table_name = 'OrganizationAccessPreset'
  ) THEN
    ALTER TABLE "OrganizationAccessPreset"
    ADD CONSTRAINT "OrganizationAccessPreset_modeId_fkey"
      FOREIGN KEY ("modeId") REFERENCES "OrganizationMode"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;
