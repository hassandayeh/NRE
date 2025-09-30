// src/app/api/bookings/[id]/participants/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, BookingParticipantRole as Role } from "@prisma/client";

// Safe Prisma singleton (avoids depending on a local lib path)
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

// ⬇️ FIX: no export here (exporting anything other than handlers/config breaks Next routes)
const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

// Server-side feature flag (default ON). Flip to "false" in .env.local to disable POST/DELETE/GET here.
const MULTI_PARTICIPANTS_ENABLED =
  (process.env.MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";

/* ------------------------------ utilities ------------------------------ */

const ALLOWED_ROLES = new Set<"HOST" | "EXPERT" | "REPORTER" | "INTERPRETER">([
  "HOST",
  "EXPERT",
  "REPORTER",
  "INTERPRETER",
]);

type NewItem = {
  userId?: string | null;
  role: Role | string;
  isPrimaryHost?: boolean;
  notes?: string | null;
};

function toRole(v: string): Role {
  const r = (v || "").toUpperCase() as Role;
  if (!ALLOWED_ROLES.has(r as any)) throw new Error(`Invalid role: ${v}`);
  return r;
}

async function snapshotGrouped(bookingId: string) {
  const participants = await prisma.bookingParticipant.findMany({
    where: { bookingId },
    orderBy: [{ role: "asc" }, { isPrimaryHost: "desc" }, { createdAt: "asc" }],
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

  const grouped: Record<"HOST" | "EXPERT" | "REPORTER" | "INTERPRETER", any[]> =
    { HOST: [], EXPERT: [], REPORTER: [], INTERPRETER: [] };

  for (const p of participants) {
    grouped[p.role].push({
      id: p.id,
      role: p.role,
      inviteStatus: p.inviteStatus,
      isPrimaryHost: p.isPrimaryHost,
      notes: p.notes,
      invitedAt: p.invitedAt,
      respondedAt: p.respondedAt,
      userId: p.userId,
      user: p.user,
    });
  }

  return { total: participants.length, grouped };
}

/**
 * Ensures exactly one primary host per booking if any hosts exist.
 * If preferId is provided and exists, that row becomes primary; otherwise:
 * - keep the existing primary if present
 * - else promote the earliest host.
 */
async function ensureSinglePrimaryHost(
  bookingId: string,
  preferId?: string | null
) {
  const hosts = await prisma.bookingParticipant.findMany({
    where: { bookingId, role: "HOST" },
    orderBy: { createdAt: "asc" },
    select: { id: true, isPrimaryHost: true },
  });

  if (hosts.length === 0) return;

  let target: string | null =
    (preferId && hosts.find((h) => h.id === preferId)?.id) || null;

  if (!target) {
    target = hosts.find((h) => h.isPrimaryHost)?.id ?? hosts[0].id;
  }

  // Demote all, then promote the target
  await prisma.bookingParticipant.updateMany({
    where: { bookingId, role: "HOST" },
    data: { isPrimaryHost: false },
  });

  await prisma.bookingParticipant.update({
    where: { id: target },
    data: { isPrimaryHost: true },
  });
}

/* -------------------------------- GET -------------------------------- */
/**
 * GET /api/bookings/:id/participants
 * Read-only. Returns participants grouped by role. Legacy tables untouched.
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

    const { total, grouped } = await snapshotGrouped(bookingId);

    return NextResponse.json(
      { enabled: true, bookingId, total, grouped },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /bookings/:id/participants failed:", err);
    return NextResponse.json(
      { error: "Failed to load participants." },
      { status: 500 }
    );
  }
}

/* -------------------------------- POST -------------------------------- */
/**
 * POST /api/bookings/:id/participants
 * Body can be:
 * - { items: NewItem[] }
 * - NewItem[]
 * - NewItem
 *
 * Notes:
 * - Only HOST rows may set isPrimaryHost; others are forced to false.
 * - Internals (with userId) are de-duped by the DB (unique index) if present.
 * - After insert, we enforce exactly one primary host (if any hosts exist).
 */
export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    if (!MULTI_PARTICIPANTS_ENABLED) {
      return NextResponse.json(
        { error: "Participants writes are disabled by flag." },
        { status: 501 }
      );
    }

    const bookingId = ctx.params?.id;
    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing booking id in route params." },
        { status: 400 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    let items: NewItem[] = [];
    if (Array.isArray(body)) items = body;
    else if (Array.isArray(body?.items)) items = body.items;
    else if (body && typeof body === "object") items = [body];
    else
      return NextResponse.json(
        { error: "No items to create." },
        { status: 400 }
      );

    if (!items.length)
      return NextResponse.json({ error: "Empty items." }, { status: 400 });

    let preferPrimaryId: string | null = null;

    // Use individual creates so we can capture ids (needed to set primary)
    for (const raw of items) {
      const role = toRole(String(raw.role));
      const data = {
        bookingId,
        userId: raw.userId ?? null,
        role,
        notes: raw.notes ?? null,
        isPrimaryHost: role === "HOST" ? !!(raw as any).isPrimaryHost : false,
      };

      try {
        const created = await prisma.bookingParticipant.create({ data });
        if (role === "HOST" && data.isPrimaryHost) preferPrimaryId = created.id;
      } catch (e: any) {
        // Unique conflict (internal already exists) → fetch existing id (for primary if needed)
        if (String(e?.code) === "P2002") {
          if (role === "HOST" && data.isPrimaryHost && data.userId) {
            const existing = await prisma.bookingParticipant.findFirst({
              where: { bookingId, role: "HOST", userId: data.userId },
              select: { id: true },
            });
            if (existing) preferPrimaryId = existing.id;
          }
          // else ignore duplicate
        } else {
          throw e;
        }
      }
    }

    // Keep exactly one primary host when there are hosts
    await ensureSinglePrimaryHost(bookingId, preferPrimaryId);

    const { total, grouped } = await snapshotGrouped(bookingId);
    return NextResponse.json(
      { ok: true, bookingId, total, grouped },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /bookings/:id/participants failed:", err);
    return NextResponse.json(
      { error: "Failed to add participants." },
      { status: 500 }
    );
  }
}

/* ------------------------------- DELETE ------------------------------- */
/**
 * DELETE /api/bookings/:id/participants
 * Delete by:
 * - Query: ?id=
 * - Body: { id: "" }
 * - Body: { userId: "", role: "HOST|EXPERT|REPORTER|INTERPRETER" }
 * After delete: if primary host removed and other hosts exist → promote earliest.
 */
export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    if (!MULTI_PARTICIPANTS_ENABLED) {
      return NextResponse.json(
        { error: "Participants writes are disabled by flag." },
        { status: 501 }
      );
    }

    const bookingId = ctx.params?.id;
    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing booking id in route params." },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const qpId = url.searchParams.get("id");

    let body: any = null;
    try {
      if (req.headers.get("content-length")) {
        body = await req.json();
      }
    } catch {
      // ignore invalid body; we'll fall back to query params
    }

    let deletedPrimary = false;

    if (qpId || body?.id) {
      const id = String(qpId || body.id);

      // Check if we're deleting the primary host
      const target = await prisma.bookingParticipant.findUnique({
        where: { id },
        select: { id: true, role: true, isPrimaryHost: true },
      });

      await prisma.bookingParticipant.delete({ where: { id } });

      deletedPrimary = !!(
        target &&
        target.role === "HOST" &&
        target.isPrimaryHost
      );
    } else if (body?.userId && body?.role) {
      const role = toRole(String(body.role));
      const res = await prisma.bookingParticipant.deleteMany({
        where: { bookingId, userId: String(body.userId), role },
      });

      if (role === "HOST" && res.count > 0) {
        // We don't know if it was primary; just re-assert a primary host
        deletedPrimary = true;
      }
    } else {
      return NextResponse.json(
        { error: "Provide ?id=..., or body with { id }, or { userId, role }." },
        { status: 400 }
      );
    }

    if (deletedPrimary) {
      await ensureSinglePrimaryHost(bookingId, null);
    }

    const { total, grouped } = await snapshotGrouped(bookingId);
    return NextResponse.json(
      { ok: true, bookingId, total, grouped },
      { status: 200 }
    );
  } catch (err) {
    console.error("DELETE /bookings/:id/participants failed:", err);
    return NextResponse.json(
      { error: "Failed to delete participant(s)." },
      { status: 500 }
    );
  }
}
