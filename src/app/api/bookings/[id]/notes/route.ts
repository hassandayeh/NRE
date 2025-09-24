import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  buildBookingReadWhere,
  TENANCY_ON,
} from "../../../../../lib/viewer";

// Minimal role check for note creation (HOST+)
function canPostNote(viewer: any, orgId: string | null | undefined) {
  if (!viewer?.isSignedIn) return false;
  const roles = ["OWNER", "ADMIN", "PRODUCER", "HOST"];
  const ms = viewer?.memberships ?? viewer?.orgMemberships ?? [];
  return ms.some(
    (m: any) =>
      (!TENANCY_ON || !orgId || m.orgId === orgId) && roles.includes(m.role)
  );
}

// GET /api/bookings/:id/notes
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Reuse the same read-where as the list/detail route
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

    const notes = await prisma.bookingNote.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true } } },
    });

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
    if (!viewer.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Authorize against the target booking org using the same read-where first.
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

    if (!canPostNote(viewer, booking.orgId)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
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
