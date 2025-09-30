// src/app/api/bookings/[id]/participants/route.ts

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

/** Safe Prisma singleton (don’t export it) */
const g = globalThis as unknown as { __prisma?: PrismaClient };
const prisma =
  g.__prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

/** Server-side flag (ON by default) */
const MULTI_PARTICIPANTS_ENABLED =
  (process.env.MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";

/* ------------------------------ types & utils ------------------------------ */

type Role = "HOST" | "EXPERT" | "REPORTER" | "INTERPRETER";
const ALLOWED_ROLES: ReadonlySet<Role> = new Set([
  "HOST",
  "EXPERT",
  "REPORTER",
  "INTERPRETER",
]);

type NewItem =
  | {
      userId?: string | null;
      /** Accept either roleInBooking or role, case-insensitive */
      roleInBooking?: Role | string;
      role?: Role | string;
      notes?: string | null;
      /** Ignored; primary concept removed */
      isPrimaryHost?: boolean;
    }
  | null
  | undefined;

/** Explicit row typing so map() param isn't inferred as any */
type BookingParticipantRow = {
  id: string;
  bookingId: string;
  userId: string | null;
  role: Role;
  notes: string | null;
  inviteStatus: string | null;
  invitedAt: Date | null;
  respondedAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    displayName: string | null;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  } | null;
};

function normalizeRole(v: unknown): Role {
  const r = String(v ?? "").toUpperCase() as Role;
  if (!ALLOWED_ROLES.has(r)) throw new Error(`Invalid role: ${v}`);
  return r;
}

function pickIncomingRole(x: any): Role {
  if (x?.roleInBooking != null) return normalizeRole(x.roleInBooking);
  if (x?.role != null) return normalizeRole(x.role);
  throw new Error("Missing role/roleInBooking");
}

/* Build both shapes:
   - participants: flat array (what your Edit page expects)
   - grouped: role buckets (back-compat with older callers) */
async function snapshot(bookingId: string) {
  const rows = (await prisma.bookingParticipant.findMany({
    where: { bookingId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }], // no primary ordering
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
  })) as unknown as BookingParticipantRow[];

  type RoleKey = Role;
  const grouped: Record<RoleKey, any[]> = {
    HOST: [],
    EXPERT: [],
    REPORTER: [],
    INTERPRETER: [],
  };

  const participants = rows.map((p: BookingParticipantRow) => {
    const item = {
      id: p.id,
      userId: p.userId,
      // API uses roleInBooking; DB uses role → map it
      roleInBooking: p.role as RoleKey,
      // primary removed intentionally; client can treat missing as false
      notes: p.notes,
      inviteStatus: p.inviteStatus,
      invitedAt: p.invitedAt,
      respondedAt: p.respondedAt,
      user: p.user
        ? {
            id: p.user.id,
            name: p.user.displayName ?? p.user.name ?? null,
            email: p.user.email ?? null,
            image: p.user.avatarUrl ?? null,
          }
        : null,
    };
    const r = p.role as RoleKey;
    grouped[r].push(item);
    return item;
  });

  return { participants, grouped, total: participants.length };
}

/* ---------------------------------- GET ---------------------------------- */
/** GET /api/bookings/:id/participants
 * Returns both:
 *  - participants: ParticipantDTO[]
 *  - grouped: { HOST|EXPERT|REPORTER|INTERPRETER: ParticipantDTO[] }
 */
export async function GET(
  _req: Request,
  { params }: { params: { id?: string } }
) {
  try {
    if (!MULTI_PARTICIPANTS_ENABLED) {
      return NextResponse.json(
        { enabled: false, participants: [], grouped: null },
        { status: 200 }
      );
    }
    const bookingId = params?.id;
    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing booking id." },
        { status: 400 }
      );
    }
    const { participants, grouped, total } = await snapshot(bookingId);
    return NextResponse.json(
      { enabled: true, bookingId, total, participants, grouped },
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

/* ---------------------------------- POST --------------------------------- */
/** POST /api/bookings/:id/participants
 * Body accepted:
 *   - { participants: NewItem[] }  ← preferred
 *   - { items: NewItem[] }
 *   - NewItem[]
 *   - NewItem
 * Notes:
 *   - Primary host is not used anymore; any isPrimaryHost sent is ignored.
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
        { error: "Missing booking id." },
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
    else if (Array.isArray(body?.participants)) items = body.participants;
    else if (Array.isArray(body?.items)) items = body.items;
    else if (body && typeof body === "object") items = [body];
    else
      return NextResponse.json(
        { error: "No items to create." },
        { status: 400 }
      );

    const toCreate = (items as NewItem[]).filter(Boolean).map((x) => ({
      bookingId,
      userId: x!.userId ?? null,
      role: pickIncomingRole(x!),
      notes: x!.notes ?? null,
      // isPrimaryHost intentionally not persisted (removed)
      isPrimaryHost: false,
    }));

    // Create individually to gracefully ignore duplicates
    for (const data of toCreate) {
      try {
        await prisma.bookingParticipant.create({ data });
      } catch (e: any) {
        // P2002 = unique constraint (e.g., same userId+booking+role); ignore
        if (String(e?.code) !== "P2002") throw e;
      }
    }

    const { participants, grouped, total } = await snapshot(bookingId);
    return NextResponse.json(
      { ok: true, bookingId, total, participants, grouped },
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

/* -------------------------------- DELETE --------------------------------- */
/** DELETE /api/bookings/:id/participants
 * Delete by:
 *   - Query: ?id=…            (row id)
 *   - Body: { id: "…" }
 *   - Body: { userId: "…", role: "HOST|EXPERT|REPORTER|INTERPRETER" }
 * No auto-promotion or primary logic.
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
        { error: "Missing booking id." },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const qpId = url.searchParams.get("id");

    let body: any = null;
    try {
      if (req.headers.get("content-length")) body = await req.json();
    } catch {
      // ignore bad body
    }

    if (qpId || body?.id) {
      const id = String(qpId || body.id);
      await prisma.bookingParticipant.delete({ where: { id } });
    } else if (body?.userId && body?.role) {
      const role = normalizeRole(body.role);
      await prisma.bookingParticipant.deleteMany({
        where: { bookingId, userId: String(body.userId), role },
      });
    } else {
      return NextResponse.json(
        {
          error: "Provide ?id=… or body { id } or { userId, role } to delete.",
        },
        { status: 400 }
      );
    }

    const { participants, grouped, total } = await snapshot(bookingId);
    return NextResponse.json(
      { ok: true, bookingId, total, participants, grouped },
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
