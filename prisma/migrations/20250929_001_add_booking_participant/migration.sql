-- 20250929_001_add_booking_participant

-- Single table for all participants tied to a booking.
-- We keep role as TEXT (not a Postgres ENUM) to avoid churn while we iterate.

CREATE TABLE IF NOT EXISTS "BookingParticipant" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL,
  "role" TEXT NOT NULL,              -- e.g. HOST | EXPERT | REPORTER | INTERPRETER | PRESENTER
  "orgId" TEXT,                      -- owning org when applicable
  "userId" TEXT,                     -- staff user (e.g., host)
  "expertId" TEXT,                   -- expert directory link
  "reporterId" TEXT,                 -- reporter directory link
  "displayName" TEXT,                -- fallback label if no foreign key
  "status" TEXT NOT NULL DEFAULT 'ADDED',   -- lifecycle placeholder (INVITED/CONFIRMED/etc. future)
  "position" INTEGER NOT NULL DEFAULT 0,    -- ordering within role
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "BookingParticipant_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "BookingParticipant_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Org"("id")
    ON DELETE SET NULL,

  CONSTRAINT "BookingParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL,

  CONSTRAINT "BookingParticipant_expertId_fkey"
    FOREIGN KEY ("expertId") REFERENCES "Expert"("id")
    ON DELETE SET NULL,

  CONSTRAINT "BookingParticipant_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "Reporter"("id")
    ON DELETE SET NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS "BookingParticipant_bookingId_idx"
  ON "BookingParticipant" ("bookingId");

CREATE INDEX IF NOT EXISTS "BookingParticipant_bookingId_role_idx"
  ON "BookingParticipant" ("bookingId","role");

CREATE INDEX IF NOT EXISTS "BookingParticipant_userId_idx"
  ON "BookingParticipant" ("userId");

CREATE INDEX IF NOT EXISTS "BookingParticipant_expertId_idx"
  ON "BookingParticipant" ("expertId");

CREATE INDEX IF NOT EXISTS "BookingParticipant_reporterId_idx"
  ON "BookingParticipant" ("reporterId");

-- Guardrails against duplicate rows for the same entity in a booking/role.
CREATE UNIQUE INDEX IF NOT EXISTS "BookingParticipant_unique_user_per_booking"
  ON "BookingParticipant" ("bookingId","role","userId")
  WHERE "userId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BookingParticipant_unique_expert_per_booking"
  ON "BookingParticipant" ("bookingId","role","expertId")
  WHERE "expertId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BookingParticipant_unique_reporter_per_booking"
  ON "BookingParticipant" ("bookingId","role","reporterId")
  WHERE "reporterId" IS NOT NULL;
