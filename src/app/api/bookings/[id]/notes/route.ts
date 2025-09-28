// src/app/api/bookings/[id]/notes/route.ts
import { NextResponse, NextRequest } from "next/server";
import prisma from "../../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  canEditBooking,
  TENANCY_ON,
} from "../../../../../lib/viewer";

/**
 * Notes privacy model
 * - Staff (OWNER/PRODUCER/HOST): READ staff notes, POST notes.
 * - Guests/Experts: READ only their own notes, POST notes.
 */

// ---------------- utils ----------------
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

function isStaffEditor(
  viewer: Awaited<ReturnType<typeof resolveViewerFromRequest>>,
  orgId: string | null
) {
  // canEditBooking typically covers OWNER/PRODUCER/etc.
  return orgId ? canEditBooking(viewer, orgId) : false;
}

// Compute which authors are staff for this org
async function resolveStaffAuthorIdsForOrg(
  orgId: string | null,
  authorIds: string[]
): Promise<Set<string>> {
  if (!TENANCY_ON || !orgId || authorIds.length === 0) return new Set();
  const STAFF_ROLES = ["OWNER", "ADMIN", "PRODUCER", "HOST"] as const;
  const rows = await prisma.organizationMembership.findMany({
    where: {
      orgId,
      userId: { in: authorIds },
      role: { in: STAFF_ROLES as any },
    },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

// ---------------- GET /api/bookings/[id]/notes ----------------
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

    const staffEditor = isStaffEditor(viewer, booking.orgId);
    const hostMember = await isHostOfOrg(viewer.userId, booking.orgId);
    const isStaffOrHost = staffEditor || hostMember;

    if (isStaffOrHost) {
      // Staff can read staff-authored notes only
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

      const authorIds = Array.from(
        new Set(notes.map((n) => n.authorId).filter(Boolean) as string[])
      );
      const staffAuthorIds = await resolveStaffAuthorIdsForOrg(
        booking.orgId,
        authorIds
      );
      const staffNotes = notes.filter((n) => staffAuthorIds.has(n.authorId));

      const shaped = staffNotes.map((n) => ({
        id: n.id,
        bookingId: n.bookingId,
        authorId: n.authorId,
        authorName: n.author?.name ?? "Someone",
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      }));

      return NextResponse.json({ ok: true, notes: shaped }, { status: 200 });
    }

    // Guest/Expert viewer → return ONLY their own notes for this booking
    const ownNotes = await prisma.bookingNote.findMany({
      where: {
        bookingId: booking.id,
        authorId: viewer.userId ?? "__none__", // ensures empty when missing id
      },
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

    const shapedOwn = ownNotes.map((n) => ({
      id: n.id,
      bookingId: n.bookingId,
      authorId: n.authorId,
      authorName: n.author?.name ?? "You",
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, notes: shapedOwn }, { status: 200 });
  } catch (err) {
    console.error("GET /api/bookings/[id]/notes error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load notes" },
      { status: 500 }
    );
  }
}

// ---------------- POST /api/bookings/[id]/notes ----------------
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

    const json = (await req.json().catch(() => ({} as any))) as {
      body?: string;
    };
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
