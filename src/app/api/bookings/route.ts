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

type BookingRow = {
  id: string;
  orgId: string;
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

    // server-side sort: "booking" (default) or "created"
    const sortMode = (searchParams.get("sort") || "booking").toLowerCase();
    const orderBy =
      sortMode === "created"
        ? [{ createdAt: "desc" as const }, { startAt: "desc" as const }]
        : [{ startAt: "desc" as const }, { createdAt: "desc" as const }];

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

    if (!rows.length) {
      return NextResponse.json({ ok: true, bookings: [] }, { status: 200 });
    }

    // ---------- Enrich with participant names (Host/Expert) ----------
    const bookingIds = rows.map((r) => r.id);

    // Pull minimal participant info + staff user names
    const parts = await prisma.bookingParticipant.findMany({
      where: { bookingId: { in: bookingIds } },
      select: {
        bookingId: true,
        userId: true,
        roleSlot: true,
        roleLabelSnapshot: true,
        notes: true,
        user: { select: { displayName: true, email: true } },
      },
      orderBy: [{ roleSlot: "asc" }, { id: "asc" }],
    });

    // Collect guest-profile ids for public participants (gp:<id> in notes)
    const fallbackIds = new Set<string>();
    for (const p of parts) {
      const hasStaffName = p?.user?.displayName || p?.user?.email;
      if (!hasStaffName && typeof p.notes === "string" && p.notes) {
        const m = /^gp:(.+)$/.exec(p.notes.trim());
        if (m && m[1]) fallbackIds.add(m[1]);
      }
    }

    // Batch fetch GuestProfile names (fail-soft)
    const gpMap = new Map<string, { displayName: string | null }>();
    if (fallbackIds.size) {
      try {
        const gpRows = await (prisma as any).guestProfile.findMany({
          where: { id: { in: Array.from(fallbackIds) } },
          select: { id: true, displayName: true },
        });
        for (const g of gpRows || []) {
          gpMap.set(String(g.id), { displayName: g.displayName ?? null });
        }
      } catch {
        // ignore
      }
    }

    // Group participants by bookingId
    const byBooking = new Map<string, typeof parts>();
    for (const p of parts) {
      (
        byBooking.get(p.bookingId) ??
        byBooking.set(p.bookingId, []).get(p.bookingId)!
      ).push(p);
    }

    // Helper to render a participant display name
    const nameOf = (p: (typeof parts)[number]): string | null => {
      const u = p.user;
      let label =
        (u?.displayName && u.displayName.trim()) ||
        (u?.email && u.email.trim()) ||
        null;
      if (!label && typeof p.notes === "string" && p.notes) {
        const m = /^gp:(.+)$/.exec(p.notes.trim());
        if (m && m[1]) {
          const g = gpMap.get(m[1]);
          label = g?.displayName ?? null;
        }
      }
      return label;
    };

    const enriched = rows.map((b) => {
      const pb = byBooking.get(b.id) || [];
      const hosts = pb.filter((p) => (p.roleSlot ?? 0) === 1);
      const experts = pb.filter((p) => (p.roleSlot ?? 0) === 3);

      const hostName = hosts.map(nameOf).find(Boolean) || null;
      const expertName = experts.map(nameOf).find(Boolean) || null;
      const hostsCount = hosts.length;

      const shaped = shapeBooking(b as any) as any;
      if (hostName) shaped.hostName = hostName;
      if (expertName) shaped.expertName = expertName;
      if (hostsCount > 0) shaped.hostsCount = hostsCount;

      return shaped;
    });

    return NextResponse.json({ ok: true, bookings: enriched }, { status: 200 });
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
      accessConfig: unknown;

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

    // Canonical title: programName
    const programName =
      typeof body.programName === "string" ? body.programName.trim() : "";

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
      !programName ||
      !startAt ||
      Number.isNaN(startAt.getTime()) ||
      !durationMins
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "programName, startAt, and durationMins are required",
        },
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

    // Accept accessConfig as-is (including null, arrays, objects, scalars)
    let accessConfigData: PrismaNS.InputJsonValue | undefined = undefined;
    if (body.accessConfig !== undefined) {
      accessConfigData = body.accessConfig as PrismaNS.InputJsonValue;
    }

    const created = await prisma.booking.create({
      data: {
        orgId,

        programName: programName || null,

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
