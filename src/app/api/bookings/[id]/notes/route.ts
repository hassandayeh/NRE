import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  buildBookingReadWhere,
  TENANCY_ON,
} from "../../../../../lib/viewer";

const STAFF_ROLES = ["OWNER", "ADMIN", "PRODUCER", "HOST"] as const;

function isStaffInOrg(viewer: any, orgId: string | null | undefined) {
  const ms = viewer?.memberships ?? viewer?.orgMemberships ?? [];
  return ms.some(
    (m: any) =>
      (!TENANCY_ON || !orgId || m.orgId === orgId) &&
      STAFF_ROLES.includes(m.role)
  );
}

// GET /api/bookings/:id/notes
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Must be able to read the booking first (staff or guest)
    const where = buildBookingReadWhere(params.id, viewer, TENANCY_ON);
    const booking = await prisma.booking.findFirst({
      where,
      select: { id: true, orgId: true },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    // Who are the guests of this booking?
    const guestRows = await prisma.bookingGuest.findMany({
      where: { bookingId: booking.id, userId: { not: null } },
      select: { userId: true },
    });
    const guestUserIds = guestRows
      .map((g) => g.userId)
      .filter(Boolean) as string[];
    const isStaff = isStaffInOrg(viewer, booking.orgId);
    const isGuest = viewer.userId && guestUserIds.includes(viewer.userId);

    // Visibility
    let notes;
    if (isStaff) {
      // Staff: see all notes EXCEPT guest-authored ones
      notes = await prisma.bookingNote.findMany({
        where: {
          bookingId: booking.id,
          // exclude notes whose author is a guest user of this booking
          NOT: guestUserIds.length
            ? { authorId: { in: guestUserIds } }
            : undefined,
        },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      });
    } else if (isGuest) {
      // Guest: only their own notes
      notes = await prisma.bookingNote.findMany({
        where: {
          bookingId: booking.id,
          authorId: viewer.userId as string,
        },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      });
    } else {
      // Not staff and not a guest (shouldn't happen if buildBookingReadWhere blocked), but be explicit.
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const shaped = notes.map((n) => ({
      id: n.id,
      bookingId: n.bookingId,
      authorId: n.authorId,
      authorName: (n as any).author?.name ?? "Unknown",
      body: n.body,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));

    return NextResponse.json({ ok: true, notes: shaped });
  } catch (e) {
    console.error("GET /api/bookings/[id]/notes error:", e);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

// POST /api/bookings/:id/notes { body }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Viewer must be able to read this booking (staff or guest)
    const where = buildBookingReadWhere(params.id, viewer, TENANCY_ON);
    const booking = await prisma.booking.findFirst({
      where,
      select: { id: true, orgId: true },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    let payload: { body?: string };
    try {
      payload = (await req.json()) as { body?: string };
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }
    const body = (payload.body ?? "").trim();
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Note body is required." },
        { status: 400 }
      );
    }
    if (body.length > 4000) {
      return NextResponse.json(
        { ok: false, error: "Note is too long (max 4000 chars)." },
        { status: 400 }
      );
    }

    const note = await prisma.bookingNote.create({
      data: {
        bookingId: booking.id,
        authorId: viewer.userId as string, // viewer.isSignedIn guarantees presence
        body,
      },
    });

    const shaped = {
      id: note.id,
      bookingId: note.bookingId,
      authorId: note.authorId,
      authorName: viewer.name ?? "Unknown",
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };

    return NextResponse.json({ ok: true, note: shaped });
  } catch (e) {
    console.error("POST /api/bookings/[id]/notes error:", e);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
