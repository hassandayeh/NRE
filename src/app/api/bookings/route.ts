// src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../lib/viewer";
import { hasCan } from "../../../lib/access/permissions";
import { AppearanceType, BookingStatus } from "@prisma/client";

type BookingRow = {
  id: string;
  orgId: string;
  subject: string;
  status: BookingStatus;
  startAt: Date;
  durationMins: number;
  appearanceType: AppearanceType | null;
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function shapeBooking(b: BookingRow) {
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

function parseAppearanceType(v: unknown): AppearanceType | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  if (v === "ONLINE" || v === "IN_PERSON" || v === "PHONE") {
    return v as AppearanceType;
  }
  return undefined;
}

// ---------------- GET /api/bookings ----------------
// Query params:
//   orgId (required) - the organization to list bookings for
//   take (optional, default 50), skip (optional, default 0)
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId") ?? "";
    const take = Math.min(
      Math.max(parseInt(searchParams.get("take") || "50", 10), 1),
      200
    );
    const skip = Math.max(parseInt(searchParams.get("skip") || "0", 10), 0);

    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    const canView = await hasCan({
      userId: viewer.userId,
      orgId,
      permission: "booking:view",
    });
    if (!canView) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const rows = await prisma.booking.findMany({
      where: { orgId },
      orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
      take,
      skip,
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
      { ok: true, bookings: rows.map(shapeBooking) },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/bookings error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load bookings" },
      { status: 500 }
    );
  }
}

// ---------------- POST /api/bookings ----------------
// Body:
//   orgId (required), subject (required), startAt (required), durationMins (required number)
//   Optional: appearanceType | locationUrl | locationName | locationAddress | dialInfo
export async function POST(req: NextRequest) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Partial<{
      orgId: string;
      subject: string;
      startAt: string | Date;
      durationMins: number;
      appearanceType: string | null;
      locationUrl: string | null;
      locationName: string | null;
      locationAddress: string | null;
      dialInfo: string | null;
    }>;

    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    const canCreate = await hasCan({
      userId: viewer.userId,
      orgId,
      permission: "booking:create",
    });
    if (!canCreate) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const subject =
      typeof body.subject === "string" && body.subject.trim().length > 0
        ? body.subject.trim()
        : "";
    const startAt = body.startAt ? new Date(body.startAt) : undefined;
    const durationMins = Number.isInteger(body.durationMins as any)
      ? (body.durationMins as number)
      : undefined;

    if (!subject || !startAt || !durationMins) {
      return NextResponse.json(
        { ok: false, error: "subject, startAt, and durationMins are required" },
        { status: 400 }
      );
    }

    const created = await prisma.booking.create({
      data: {
        orgId,
        subject,
        startAt,
        durationMins,
        status: BookingStatus.PENDING,
        appearanceType: parseAppearanceType(body.appearanceType) ?? null,
        locationUrl:
          body.locationUrl === null || typeof body.locationUrl === "string"
            ? body.locationUrl ?? null
            : null,
        locationName:
          body.locationName === null || typeof body.locationName === "string"
            ? body.locationName ?? null
            : null,
        locationAddress:
          body.locationAddress === null ||
          typeof body.locationAddress === "string"
            ? body.locationAddress ?? null
            : null,
        dialInfo:
          body.dialInfo === null || typeof body.dialInfo === "string"
            ? body.dialInfo ?? null
            : null,
      },
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
      { ok: true, booking: shapeBooking(created) },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/bookings error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
