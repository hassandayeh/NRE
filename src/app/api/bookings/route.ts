// src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../lib/viewer";
import { hasCan } from "../../../lib/access/permissions";
import { AppearanceType, BookingStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";

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

async function deriveOrgId(
  req: NextRequest,
  seed?: string | null,
  viewer?: any
): Promise<string | null> {
  if (typeof seed === "string" && seed.trim()) return seed.trim();
  const h = req.headers.get("x-org-id");
  if (h && h.trim()) return h.trim();
  const q = new URL(req.url).searchParams.get("orgId");
  if (q && q.trim()) return q.trim();
  const vOrg =
    (viewer?.orgId as string | undefined) ??
    (viewer?.org?.id as string | undefined);
  if (vOrg && vOrg.trim()) return vOrg.trim();
  try {
    const session = await getServerSession(authOptions);
    const sOrg =
      (((session as any)?.user?.orgId as string | undefined) ??
        (session as any)?.orgId) ||
      null;
    if (sOrg && String(sOrg).trim()) return String(sOrg).trim();
  } catch {}
  return null;
}

// ---------------- GET /api/bookings ----------------
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
    const orgId =
      (await deriveOrgId(req, searchParams.get("orgId"), viewer)) || "";

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

      // Non-hosts from the New page:
      guests: Array<{
        userId: string | null;
        name?: string | null;
        kind?: "EXPERT" | "REPORTER";
        order?: number;
        appearanceType?: "ONLINE" | "IN_PERSON" | "PHONE";
        joinUrl?: string | null;
        venueName?: string | null;
        venueAddress?: string | null;
        dialInfo?: string | null;
      }>;
    }>;

    const orgId =
      (await deriveOrgId(
        req,
        typeof body.orgId === "string" ? body.orgId : null,
        viewer
      )) || "";

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
    const startAtRaw = body.startAt;
    const startAt =
      startAtRaw instanceof Date
        ? startAtRaw
        : typeof startAtRaw === "string"
        ? new Date(startAtRaw)
        : undefined;
    const durationMins =
      typeof body.durationMins === "number" &&
      Number.isFinite(body.durationMins)
        ? Math.trunc(body.durationMins)
        : undefined;

    if (
      !subject ||
      !startAt ||
      Number.isNaN(startAt.getTime()) ||
      !durationMins
    ) {
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

    // ---- Persist non-host participants from body.guests (if provided)
    try {
      const guests = Array.isArray((body as any).guests)
        ? ((body as any).guests as Array<any>)
        : [];

      if (guests.length) {
        // Validate which provided IDs correspond to real Users.
        const candidateIds = Array.from(
          new Set(
            guests
              .map((g) =>
                g && typeof g.userId === "string" ? g.userId.trim() : ""
              )
              .filter(Boolean)
          )
        );

        const existingUsers = candidateIds.length
          ? await prisma.user.findMany({
              where: { id: { in: candidateIds } },
              select: { id: true },
            })
          : [];

        const validUserId = new Set(existingUsers.map((u) => u.id));

        const now = new Date();
        const rows = guests
          .filter((g) => g) // keep all rows; userId may be null for public experts
          .map((g) => {
            const kind = String(g.kind ?? "").toUpperCase();
            const isReporter = kind === "REPORTER";
            const roleSlot = isReporter ? 2 : 3; // 2: Producer (reporter), 3: Expert
            const roleLabelSnapshot = isReporter ? "Producer" : "Expert";
            const proposedId =
              typeof g.userId === "string" ? g.userId.trim() : null;

            return {
              bookingId: created.id,
              // Only keep userId if it actually exists in our Users table; otherwise store null.
              userId:
                proposedId && validUserId.has(proposedId) ? proposedId : null,
              roleSlot,
              roleLabelSnapshot,
              inviteStatus: "PENDING" as const,
              invitedByUserId: viewer.userId,
              invitedAt: now,
            };
          });

        if (rows.length) {
          await prisma.bookingParticipant.createMany({
            data: rows,
            skipDuplicates: true,
          });
        }
      }
    } catch (e) {
      console.warn("POST /api/bookings: guests persistence skipped", e);
      // Don’t fail the booking creation flow if participant insert has issues.
    }

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
