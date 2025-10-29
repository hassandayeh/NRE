// src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import {
  Prisma as PrismaNS,
  AppearanceType,
  BookingStatus,
} from "@prisma/client";
import { resolveViewerFromRequest } from "../../../lib/viewer";
import { hasCan } from "../../../lib/access/permissions";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";

/* ========================= helpers & types ========================= */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

type BookingRow = {
  id: string;
  orgId: string;
  subject: string;
  programName: string | null; // NEW
  talkingPoints: string | null; // NEW (HTML)
  status: BookingStatus;
  startAt: Date;
  durationMins: number;
  appearanceType: AppearanceType | null;
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;
  newsroomName: string | null;
  accessConfig: PrismaNS.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

function shapeBooking(b: BookingRow) {
  return {
    id: b.id,
    orgId: b.orgId,
    // Program name is now canonical; keep subject for back-compat readers
    subject: b.subject,
    programName: b.programName ?? null, // NEW
    talkingPoints: b.talkingPoints ?? null, // NEW
    status: b.status,
    startAt: b.startAt.toISOString(),
    durationMins: b.durationMins,
    appearanceType: b.appearanceType,
    locationUrl: b.locationUrl,
    locationName: b.locationName,
    locationAddress: b.locationAddress,
    dialInfo: b.dialInfo,
    newsroomName: b.newsroomName ?? null,
    accessConfig: b.accessConfig ?? null,
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

/* ============================ GET (list) =========================== */

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
        programName: true, // NEW
        talkingPoints: true, // NEW
        status: true,
        startAt: true,
        durationMins: true,
        appearanceType: true,
        locationUrl: true,
        locationName: true,
        locationAddress: true,
        dialInfo: true,
        newsroomName: true,
        accessConfig: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      { ok: true, bookings: rows.map(shapeBooking as any) },
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

/* ============================ POST (create) ============================ */

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

      // New canonical field shown in UI
      programName: string | null; // NEW
      // Back-compat: still accepted if sent by older clients
      subject: string | null;

      // Rich text HTML from the editor
      talkingPoints: string | null; // NEW

      startAt: string | Date;
      durationMins: number;

      appearanceType: string | null;
      locationUrl: string | null;
      locationName: string | null;
      locationAddress: string | null;
      dialInfo: string | null;

      newsroomName: string | null;

      // JSON access knobs from Mode & Access control
      accessConfig: Record<string, unknown>;
      // Legacy “guests” persistence (kept as-is)
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

    // Canonical title: programName — but keep subject bridge for now.
    const programName =
      typeof body.programName === "string" ? body.programName.trim() : "";
    const subjectRaw =
      typeof body.subject === "string" ? body.subject.trim() : "";
    const subject = subjectRaw || programName; // bridge

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

    // Normalize talking points: accept string or null (HTML allowed)
    const talkingPoints =
      body.talkingPoints === null || typeof body.talkingPoints === "string"
        ? typeof body.talkingPoints === "string" &&
          body.talkingPoints.trim().length === 0
          ? null
          : (body.talkingPoints as string | null)
        : null;

    // Normalize accessConfig: only include when it's a plain object.
    // (Avoid passing `null` to JSON column to satisfy Prisma's input type.)
    let accessConfigData: PrismaNS.InputJsonValue | undefined = undefined;
    if (isPlainObject(body.accessConfig)) {
      accessConfigData =
        body.accessConfig as unknown as PrismaNS.InputJsonValue;
    }

    const created = await prisma.booking.create({
      data: {
        orgId,
        // Back-compat & canonical
        subject,
        programName: programName || null, // NEW
        talkingPoints, // NEW

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

        newsroomName:
          body.newsroomName === null || typeof body.newsroomName === "string"
            ? body.newsroomName?.trim() || null
            : null,

        ...(accessConfigData !== undefined
          ? { accessConfig: accessConfigData }
          : {}),
      },
      select: {
        id: true,
        orgId: true,
        subject: true,
        programName: true, // NEW
        talkingPoints: true, // NEW
        status: true,
        startAt: true,
        durationMins: true,
        appearanceType: true,
        locationUrl: true,
        locationName: true,
        locationAddress: true,
        dialInfo: true,
        newsroomName: true,
        accessConfig: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    /* ---- Persist non-host participants from body.guests (kept as-is) ---- */
    try {
      const guests = Array.isArray((body as any).guests)
        ? ((body as any).guests as Array<any>)
        : [];

      if (guests.length) {
        const candidateIds = Array.from(
          new Set(
            guests
              .map((g) =>
                g && typeof g.userId === "string" ? g.userId.trim() : ""
              )
              .filter(Boolean)
          )
        );

        const existingUsers: Array<{ id: string }> = candidateIds.length
          ? await prisma.user.findMany({
              where: { id: { in: candidateIds } },
              select: { id: true },
            })
          : [];

        const validUserId = new Set(existingUsers.map((u) => u.id));

        const now = new Date();
        const rows = guests
          .filter((g) => g)
          .map((g) => {
            const kind = String(g.kind ?? "").toUpperCase();
            const isReporter = kind === "REPORTER";
            const roleSlot = isReporter ? 2 : 3; // 2: Producer, 3: Expert
            const roleLabelSnapshot = isReporter ? "Producer" : "Expert";
            const proposedId =
              typeof g.userId === "string" ? g.userId.trim() : null;

            return {
              bookingId: created.id,
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
    }

    return NextResponse.json(
      { ok: true, booking: shapeBooking(created as any) },
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
