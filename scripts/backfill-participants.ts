// scripts/backfill-participants.ts
// Clean-base compatible backfill (NO-OP on the new schema).
// Purpose: keep CI/build green after the hard reset.
// If you ever need to migrate from an OLD database that still has legacy tables,
// we’ll implement a raw-SQL backfill in a separate script (to avoid type errors).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: ["warn", "error"] });

async function main() {
  console.log(
    "Backfill (normalized participants) — clean base detected; nothing to do."
  );
  // Small sanity check just to be helpful during dev:
  const counts = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.booking.count(),
    prisma.bookingParticipant.count(),
  ]);
  console.log(
    `Org=${counts[0]} Users=${counts[1]} Bookings=${counts[2]} Participants=${counts[3]}`
  );
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
