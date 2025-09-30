// scripts/backfill-participants.ts
// Backfills normalized BookingParticipant from BookingHost + BookingGuest.
// Run:
//   DRY_RUN=true npx tsx scripts/backfill-participants.ts
//   npx tsx scripts/backfill-participants.ts

import * as dotenv from "dotenv";
dotenv.config({ path: ".env" }); // base (Prisma uses this)
dotenv.config({ path: ".env.local", override: true }); // local overrides

import { PrismaClient } from "@prisma/client";

// Local role type (do NOT import non-existent Prisma enum)
type Role = "HOST" | "EXPERT" | "REPORTER" | "INTERPRETER";

const prisma = new PrismaClient({ log: ["warn", "error"] });

const DRY_RUN = (process.env.DRY_RUN ?? "false") === "true";
const BATCH = 100;

type Row = {
  bookingId: string;
  userId: string | null;
  role: Role;
  isPrimaryHost: boolean;
};

async function backfillBatch(skip: number) {
  const bookings = await prisma.booking.findMany({
    skip,
    take: BATCH,
    orderBy: { createdAt: "asc" },
    include: {
      hosts: { orderBy: { order: "asc" } },
      guests: {
        orderBy: { order: "asc" },
        select: { userId: true, kind: true },
      },
    },
  });

  if (bookings.length === 0) return 0;

  for (const b of bookings) {
    const legacyHosts = b.hosts ?? [];
    const legacyGuests = b.guests ?? [];

    const rows: Row[] = [];

    // HOSTS
    let primaryAssigned = false;
    for (let i = 0; i < legacyHosts.length; i++) {
      const h = legacyHosts[i];
      const isPrimary =
        !!b.hostUserId && !!h.userId && h.userId === b.hostUserId;

      rows.push({
        bookingId: b.id,
        userId: h.userId ?? null,
        role: "HOST",
        isPrimaryHost: !!isPrimary,
      });

      if (isPrimary) primaryAssigned = true;
    }

    // If no explicit primary, make the first host primary (if any)
    if (!primaryAssigned && legacyHosts.length > 0) {
      const idx = rows.findIndex((r) => r.role === "HOST");
      if (idx >= 0) rows[idx].isPrimaryHost = true;
    }

    // GUESTS (EXPERT / REPORTER)
    for (const g of legacyGuests) {
      const role: Role = g.kind === "REPORTER" ? "REPORTER" : "EXPERT";
      rows.push({
        bookingId: b.id,
        userId: g.userId ?? null,
        role,
        isPrimaryHost: false,
      });
    }

    // Local de-dupe by (bookingId, userId, role)
    const uniqueKey = new Set<string>();
    const toInsert = rows.filter((r) => {
      const k = `${r.bookingId}::${r.userId ?? "null"}::${r.role}`;
      if (uniqueKey.has(k)) return false;
      uniqueKey.add(k);
      return true;
    });

    const legacyCount = legacyHosts.length + legacyGuests.length;

    if (DRY_RUN) {
      const currentNew = await prisma.bookingParticipant.count({
        where: { bookingId: b.id },
      });
      const projected = currentNew + toInsert.length;
      console.log(
        `[DRY] ${b.id} legacy=${legacyCount} new=${currentNew} -> ${projected} (+${toInsert.length})`
      );
    } else {
      await prisma.bookingParticipant.createMany({
        data: toInsert.map((r) => ({
          bookingId: r.bookingId,
          userId: r.userId,
          role: r.role,
          isPrimaryHost: r.isPrimaryHost,
        })),
        skipDuplicates: true,
      });

      const newCount = await prisma.bookingParticipant.count({
        where: { bookingId: b.id },
      });
      console.log(`${b.id} legacy=${legacyCount} new=${newCount}`);
    }
  }

  return bookings.length;
}

async function main() {
  console.log(
    `Backfill BookingParticipant (batch=${BATCH}) DRY_RUN=${DRY_RUN}`
  );

  let skip = 0;
  while (true) {
    const n = await backfillBatch(skip);
    if (n === 0) break;
    skip += n;
  }
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
