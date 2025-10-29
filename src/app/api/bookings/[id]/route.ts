// src/app/api/bookings/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan } from "../../../../lib/access/permissions";

/** Shape response — tolerates prisma type-gen lag via `any`. */
function shapeBooking(b: any) {
  return {
    id: b.id,
    orgId: b.orgId,

    // Canonical title
    programName: b.programName ?? null, // canonical title
    talkingPoints: b.talkingPoints ?? null, // HTML

    status: b.status,
    startAt: new Date(b.startAt).toISOString(),
    durationMins: b.durationMins,

    appearanceType: b.appearanceType ?? null,
    locationUrl: b.locationUrl ?? null,
    locationName: b.locationName ?? null,
    locationAddress: b.locationAddress ?? null,
    dialInfo: b.dialInfo ?? null,

    newsroomName: b.newsroomName ?? null,

    // Access config (stored JSON)
    accessConfig: b.accessConfig ?? null,

    createdAt: new Date(b.createdAt).toISOString(),
    updatedAt: new Date(b.updatedAt).toISOString(),
  };
}

/* ---------------- GET /api/bookings/[id] ---------------- */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { ok: true, booking: shapeBooking(booking as any) },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load booking" },
      { status: 500 }
    );
  }
}

/* ---------------- PATCH /api/bookings/[id] ---------------- */
export async function PATCH(
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

    // Load existing row (no select)
    const existing = (await prisma.booking.findUnique({
      where: { id: params.id },
    })) as any;

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const canUpdate = await hasCan({
      userId: viewer.userId,
      orgId: existing.orgId!,
      permission: "booking:update",
    });
    if (!canUpdate) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Partial<{
      // Canonical title
      programName: string | null;

      // Rich text
      talkingPoints: string | null;

      // Core timing/status
      status: string; // BookingStatus as string
      startAt: string | Date;
      durationMins: number;

      // Appearance / location
      appearanceType: string | null; // "ONLINE" | "IN_PERSON" | "PHONE" | null
      locationUrl: string | null;
      locationName: string | null;
      locationAddress: string | null;
      dialInfo: string | null;

      // Misc
      newsroomName: string | null;

      // Access (any JSON)
      accessConfig: unknown;
    }>;

    const data: any = {};

    // programName (canonical)
    if (body.programName === null || typeof body.programName === "string") {
      const v =
        typeof body.programName === "string" ? body.programName.trim() : null;
      data.programName = v && v.length ? v : null;
    }

    // talkingPoints (HTML string or null)
    if (body.talkingPoints === null || typeof body.talkingPoints === "string") {
      const v =
        typeof body.talkingPoints === "string"
          ? body.talkingPoints.trim()
          : null;
      data.talkingPoints = v && v.length ? v : null;
    }

    if (typeof body.status === "string") data.status = body.status;

    if (body.startAt) {
      const d = new Date(body.startAt);
      if (!Number.isNaN(d.getTime())) data.startAt = d;
    }

    if (Number.isInteger(body.durationMins as any)) {
      data.durationMins = body.durationMins;
    }

    if (
      body.appearanceType === null ||
      typeof body.appearanceType === "string"
    ) {
      data.appearanceType = body.appearanceType ?? null;
    }

    if (body.locationUrl === null || typeof body.locationUrl === "string") {
      data.locationUrl = body.locationUrl ?? null;
    }

    if (body.locationName === null || typeof body.locationName === "string") {
      data.locationName = body.locationName ?? null;
    }

    if (
      body.locationAddress === null ||
      typeof body.locationAddress === "string"
    ) {
      data.locationAddress = body.locationAddress ?? null;
    }

    if (body.dialInfo === null || typeof body.dialInfo === "string") {
      data.dialInfo = body.dialInfo ?? null;
    }

    // newsroomName (string or null)
    if (body.newsroomName === null || typeof body.newsroomName === "string") {
      const v =
        typeof body.newsroomName === "string" ? body.newsroomName.trim() : null;
      data.newsroomName = v && v.length ? v : null;
    }

    // Access config — accept any JSON as-is (replace)
    if (body.accessConfig !== undefined) {
      data.accessConfig = body.accessConfig as any;
    }

    // Update and return full row (no select)
    const updated = await prisma.booking.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json(
      { ok: true, booking: shapeBooking(updated as any) },
      { status: 200 }
    );
  } catch (err) {
    console.error("PATCH /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update booking" },
      { status: 500 }
    );
  }
}

/* ---------------- DELETE /api/bookings/[id] ---------------- */
export async function DELETE(
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

    const existing = await prisma.booking.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const canDelete = await hasCan({
      userId: viewer.userId,
      orgId: (existing as any).orgId!,
      permission: "booking:delete",
    });
    if (!canDelete) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    await prisma.booking.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("DELETE /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to delete booking" },
      { status: 500 }
    );
  }
}
