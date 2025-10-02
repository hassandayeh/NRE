// src/app/api/bookings/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan } from "../../../../lib/access/permissions";

function shapeBooking(b: {
  id: string;
  orgId: string;
  subject: string;
  status: string;
  startAt: Date;
  durationMins: number;
  appearanceType: string | null;
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    orgId: b.orgId,
    subject: b.subject,
    status: b.status,
    startAt: b.startAt.toISOString(),
    durationMins: b.durationMins,
    appearanceType: b.appearanceType,
    locationUrl: b.locationUrl,
    locationName: b.locationName,
    locationAddress: b.locationAddress,
    dialInfo: b.dialInfo,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// ---------------- GET /api/bookings/[id] ----------------
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        orgId: true,
        subject: true,
        status: true,
        startAt: true,
        durationMins: true,
        appearanceType: true,
        locationUrl: true,
        locationName: true,
        locationAddress: true,
        dialInfo: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { ok: true, booking: shapeBooking(booking) },
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

// ---------------- PATCH /api/bookings/[id] ----------------
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

    const existing = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { id: true, orgId: true },
    });
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
      subject: string;
      status: string; // BookingStatus
      startAt: string | Date;
      durationMins: number;
      appearanceType: string | null; // AppearanceType | null
      locationUrl: string | null;
      locationName: string | null;
      locationAddress: string | null;
      dialInfo: string | null;
    }>;

    const data: any = {};
    if (typeof body.subject === "string") data.subject = body.subject.trim();
    if (typeof body.status === "string") data.status = body.status;
    if (body.startAt) data.startAt = new Date(body.startAt);
    if (Number.isInteger(body.durationMins as any))
      data.durationMins = body.durationMins;
    if (body.appearanceType === null || typeof body.appearanceType === "string")
      data.appearanceType = body.appearanceType ?? null;
    if (body.locationUrl === null || typeof body.locationUrl === "string")
      data.locationUrl = body.locationUrl ?? null;
    if (body.locationName === null || typeof body.locationName === "string")
      data.locationName = body.locationName ?? null;
    if (
      body.locationAddress === null ||
      typeof body.locationAddress === "string"
    )
      data.locationAddress = body.locationAddress ?? null;
    if (body.dialInfo === null || typeof body.dialInfo === "string")
      data.dialInfo = body.dialInfo ?? null;

    const updated = await prisma.booking.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        orgId: true,
        subject: true,
        status: true,
        startAt: true,
        durationMins: true,
        appearanceType: true,
        locationUrl: true,
        locationName: true,
        locationAddress: true,
        dialInfo: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { ok: true, booking: shapeBooking(updated) },
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

// ---------------- DELETE /api/bookings/[id] ----------------
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
      select: { id: true, orgId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const canDelete = await hasCan({
      userId: viewer.userId,
      orgId: existing.orgId!,
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
