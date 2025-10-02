// src/app/api/bookings/[id]/notes/route.ts
import { NextResponse, NextRequest } from "next/server";
import prisma from "../../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../../lib/viewer";
import { hasCan } from "../../../../../lib/access/permissions";

// ---------------- GET /api/bookings/[id]/notes ----------------
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

    const canReadAll =
      !!viewer.userId &&
      !!booking.orgId &&
      (await hasCan({
        userId: viewer.userId,
        orgId: booking.orgId,
        permission: "notes:read",
      }));

    const where = canReadAll
      ? { bookingId: booking.id }
      : { bookingId: booking.id, authorId: viewer.userId ?? "__none__" };

    const notes = await prisma.bookingNote.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        bookingId: true,
        authorId: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, displayName: true } },
      },
    });

    const shaped = notes.map((n) => ({
      id: n.id,
      bookingId: n.bookingId,
      authorId: n.authorId,
      authorName: n.author?.displayName ?? (canReadAll ? "Someone" : "You"),
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

// ---------------- POST /api/bookings/[id]/notes ----------------
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
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

    const canWrite = await hasCan({
      userId: viewer.userId,
      orgId: booking.orgId,
      permission: "notes:write",
    });

    if (!canWrite) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
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
      data: { bookingId: booking.id, authorId: viewer.userId, body },
      select: {
        id: true,
        bookingId: true,
        authorId: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, displayName: true } },
      },
    });

    return NextResponse.json(
      {
        ok: true,
        note: {
          id: note.id,
          bookingId: note.bookingId,
          authorId: note.authorId,
          authorName: note.author?.displayName ?? "Someone",
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
