// src/app/api/bookings/[id]/notes/route.ts
import { NextResponse, NextRequest } from "next/server";
import prisma from "../../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  canEditBooking,
  TENANCY_ON,
} from "../../../../../lib/viewer";

/**
 * Auth model:
 * - Staff can READ + POST notes (OWNER/ADMIN/PRODUCER/HOST).
 * - Experts/Guests: cannot read staff notes (403) and cannot post (403).
 *   (Your page already treats 403 on GET as "no visible notes".)
 */

// ---------- utils ----------
async function isHostOfOrg(
  userId: string | null,
  orgId: string | null
): Promise<boolean> {
  if (!TENANCY_ON || !userId || !orgId) return false;
  const row = await prisma.organizationMembership.findFirst({
    where: { userId, orgId, role: "HOST" as any },
    select: { id: true },
  });
  return !!row;
}

function staffCanReadOrPost(
  viewer: Awaited<ReturnType<typeof resolveViewerFromRequest>>,
  orgId: string | null
) {
  // canEditBooking = OWNER/ADMIN/PRODUCER
  return orgId ? canEditBooking(viewer, orgId) : false;
}

// ---------- GET /api/bookings/[id]/notes ----------
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

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { id: true, orgId: true },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const isStaff = staffCanReadOrPost(viewer, booking.orgId);
    const isHost = await isHostOfOrg(viewer.userId, booking.orgId);

    if (!isStaff && !isHost) {
      // Experts/Guests are not allowed to read newsroom notes
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const notes = await prisma.bookingNote.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        bookingId: true,
        authorId: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    const shaped = notes.map((n) => ({
      id: n.id,
      bookingId: n.bookingId,
      authorId: n.authorId,
      authorName: n.author?.name ?? "Someone",
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, notes: shaped }, { status: 200 });
  } catch (err) {
    console.error("GET /api/bookings/[id]/notes error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load notes" },
      { status: 500 }
    );
  }
}

// ---------- POST /api/bookings/[id]/notes ----------
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { id: true, orgId: true },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const isStaff = staffCanReadOrPost(viewer, booking.orgId);
    const isHost = await isHostOfOrg(viewer.userId, booking.orgId);

    if (!isStaff && !isHost) {
      return NextResponse.json(
        { ok: false, error: "You don’t have permission to add notes." },
        { status: 403 }
      );
    }

    const json = await req.json().catch(() => ({} as any));
    const body = (typeof json?.body === "string" ? json.body.trim() : "") || "";
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Note body is required." },
        { status: 400 }
      );
    }

    const note = await prisma.bookingNote.create({
      data: {
        bookingId: booking.id,
        authorId: viewer.userId,
        body,
      },
      select: {
        id: true,
        bookingId: true,
        authorId: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(
      {
        ok: true,
        note: {
          id: note.id,
          bookingId: note.bookingId,
          authorId: note.authorId,
          authorName: note.author?.name ?? "Someone",
          body: note.body,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/bookings/[id]/notes error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to add note" },
      { status: 500 }
    );
  }
}
