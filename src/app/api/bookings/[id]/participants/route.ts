// src/app/api/bookings/[id]/participants/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

// Safe Prisma singleton (avoids depending on a local lib path)
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma =
  globalForPrisma.__prisma ?? new PrismaClient({ log: ["warn", "error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;

// Server-side feature flag (default ON)
const MULTI_PARTICIPANTS_ENABLED =
  (process.env.MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";

/**
 * GET /api/bookings/:id/participants
 * Returns participants grouped by role from the normalized table.
 * Purely read-only; legacy tables untouched.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id?: string } }
) {
  try {
    if (!MULTI_PARTICIPANTS_ENABLED) {
      return NextResponse.json(
        { enabled: false, grouped: null },
        { status: 200 }
      );
    }

    const bookingId = params?.id;
    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing booking id in route params." },
        { status: 400 }
      );
    }

    const participants = await prisma.bookingParticipant.findMany({
      where: { bookingId },
      orderBy: [
        { role: "asc" },
        { isPrimaryHost: "desc" },
        { createdAt: "asc" },
      ],
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Group by role
    const grouped: Record<string, any[]> = {
      HOST: [],
      EXPERT: [],
      REPORTER: [],
      INTERPRETER: [],
    };

    for (const p of participants) {
      const item = {
        id: p.id,
        role: p.role,
        inviteStatus: p.inviteStatus,
        isPrimaryHost: p.isPrimaryHost,
        notes: p.notes,
        invitedAt: p.invitedAt,
        respondedAt: p.respondedAt,
        userId: p.userId,
        user: p.user,
      };
      (grouped[p.role] ?? (grouped[p.role] = [])).push(item);
    }

    return NextResponse.json(
      {
        enabled: true,
        bookingId,
        total: participants.length,
        grouped,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/bookings/:id/participants failed:", err);
    return NextResponse.json(
      { error: "Failed to load participants." },
      { status: 500 }
    );
  }
}
