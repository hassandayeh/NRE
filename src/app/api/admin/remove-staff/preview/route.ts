// src/app/api/admin/remove-staff/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

/**
 * Admin → Remove staff (preview)
 * ---------------------------------------
 * Non-destructive endpoint that *estimates* the impact of removing a staff member:
 * - threads: participants to drop
 * - files: access rows to revoke (and thus presigned links to invalidate)
 * - bookings: participants to drop + bookingIds that would show "Needs replacement"
 *
 * Nothing is mutated. Useful to feed the modal with a summary before confirming.
 *
 * INPUT (JSON or query params):
 *  - staffUserId (string)  required* (unless email is provided)
 *  - staffOrgId  (string)  required
 *  - email       (string)  optional — if provided and staffUserId omitted, we resolve by email
 *
 * OUTPUT (200):
 *  { ok: true, dryRun: true, noChangesApplied: true, input: {...}, effects: {...}, warnings: [...] }
 *
 * NOTES
 *  - We read current schema names defensively. If some models aren’t present yet in your chain
 *    (e.g. thread/file tables), we return zeros and push a warning string.
 *  - This is a *preview* only. Next slice wires the real mutation endpoint.
 */

const prisma = new PrismaClient();

// Small helper for defensive counts against optional models
async function safeCount(
  modelName: string,
  where: Record<string, any>
): Promise<{ count: number; warn?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (prisma as any)[modelName];
    if (!m?.count) return { count: 0, warn: `Model ${modelName} not found` };
    const count = await m.count({ where });
    return { count };
  } catch (e) {
    return {
      count: 0,
      warn: `Count failed on ${modelName}: ${(e as Error).message}`,
    };
  }
}

async function safeFindManyBookingIds(
  where: Record<string, any>
): Promise<{ ids: string[]; warn?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (prisma as any).bookingParticipant;
    if (!m?.findMany)
      return { ids: [], warn: "Model BookingParticipant not found" };
    const rows = (await m.findMany({
      where,
      select: { bookingId: true },
      take: 5000,
      orderBy: { bookingId: "asc" },
    })) as { bookingId: string }[];

    const ids = Array.from(new Set(rows.map((r) => r.bookingId)));
    return { ids };
  } catch (e) {
    return {
      ids: [],
      warn: `Find failed on BookingParticipant: ${(e as Error).message}`,
    };
  }
}

function badReq(detail: string) {
  return NextResponse.json({ ok: false, detail }, { status: 400 });
}

async function resolveUserIdByEmail(email: string | null | undefined) {
  if (!email) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function buildPreview(staffUserId: string, staffOrgId: string) {
  const warnings: string[] = [];

  // THREADS (legacy schema likely has userId/orgId)
  const th = await safeCount("messageThreadParticipant", {
    userId: staffUserId,
    orgId: staffOrgId,
  });
  if (th.warn) warnings.push(th.warn);

  // FILES (legacy schema likely has userId/orgId)
  const fa = await safeCount("fileAccess", {
    userId: staffUserId,
    orgId: staffOrgId,
  });
  if (fa.warn) warnings.push(fa.warn);

  // BOOKINGS (new staff refs exist on BookingParticipant in Slice 1)
  const bp = await safeCount("bookingParticipant", {
    staffUserId,
    staffOrgId,
  });
  if (bp.warn) warnings.push(bp.warn);

  const bIds = await safeFindManyBookingIds({ staffUserId, staffOrgId });
  if (bIds.warn) warnings.push(bIds.warn);

  // Rough seat calculation: removing a staff membership frees 1 seat
  const seat = 1;

  return {
    ok: true as const,
    dryRun: true,
    noChangesApplied: true,
    input: { staffUserId, staffOrgId },
    effects: {
      revokeOrgAccess: true,
      freeSeat: seat,
      threads: {
        participantsToRemove: th.count,
      },
      files: {
        accessToRevoke: fa.count,
        // We don't count individual presigned links; policy is to invalidate all for this identity.
        presignedLinksToInvalidate: "all-for-identity",
      },
      bookings: {
        participantsToDrop: bp.count,
        bookingsNeedingReplacement: {
          count: bIds.ids.length,
          ids: bIds.ids,
        },
      },
    },
    warnings,
  };
}

async function handle(req: NextRequest) {
  // Accept both POST body and GET query for convenience while wiring UI
  let staffUserId =
    req.method === "POST"
      ? (await req.json().catch(() => ({}))).staffUserId
      : req.nextUrl.searchParams.get("userId");
  const staffOrgId =
    req.method === "POST"
      ? (await req.json().catch(() => ({}))).staffOrgId
      : req.nextUrl.searchParams.get("orgId");
  const email =
    req.method === "POST"
      ? (await req.json().catch(() => ({}))).email
      : req.nextUrl.searchParams.get("email");

  if (!staffUserId && email) {
    staffUserId = await resolveUserIdByEmail(email);
  }

  if (!staffOrgId) return badReq("Missing staffOrgId.");
  if (!staffUserId)
    return badReq("Missing staffUserId (or an email that resolves to a user).");

  const preview = await buildPreview(String(staffUserId), String(staffOrgId));
  return NextResponse.json(preview, { status: 200 });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
