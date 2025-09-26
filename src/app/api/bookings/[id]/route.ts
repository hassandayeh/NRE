// src/app/api/bookings/[id]/route.ts
import { NextResponse, NextRequest } from "next/server";
import prisma from "../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  canEditBooking,
  TENANCY_ON,
} from "../../../../lib/viewer";

/** ===== Types ===== */
type AppearanceType = "ONLINE" | "IN_PERSON" | "PHONE";
type AppearanceScope = "UNIFIED" | "PER_GUEST";
type AccessProvisioning = "SHARED" | "PER_GUEST";
type ParticipantKind = "EXPERT" | "REPORTER";

type GuestInput = {
  id?: string;
  userId?: string | null;
  name: string;
  kind: ParticipantKind;
  order: number;
  appearanceType: AppearanceType;
  joinUrl?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  dialInfo?: string | null;
};

type UpdatePayload = Partial<{
  subject: string;
  newsroomName: string | null;
  programName: string | null;

  // Host (first-class + legacy mirror)
  hostName: string | null;
  hostUserId: string | null;
  talkingPoints: string | null;

  appearanceScope: AppearanceScope;
  appearanceType?: AppearanceType | null; // when UNIFIED

  accessProvisioning: AccessProvisioning;

  // Booking defaults (used as fallbacks)
  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  // Full replace of guests
  guests: GuestInput[];
}>;

/** ===== Helpers ===== */
function requireField(val: any, name: string) {
  if (val == null || (typeof val === "string" && val.trim().length === 0)) {
    throw new Error(`Missing required field: ${name}`);
  }
}

function validateUnified(
  scope: AppearanceScope,
  type: AppearanceType | null | undefined,
  effective: {
    locationUrl?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    dialInfo?: string | null;
  }
) {
  if (scope !== "UNIFIED") return;
  if (!type)
    throw new Error("appearanceType is required when appearanceScope=UNIFIED");
  if (type === "ONLINE") requireField(effective.locationUrl, "locationUrl");
  if (type === "IN_PERSON") {
    const hasVenue =
      (effective.locationName && effective.locationName.trim()) ||
      (effective.locationAddress && effective.locationAddress.trim());
    if (!hasVenue) {
      throw new Error(
        "locationName or locationAddress is required when UNIFIED+IN_PERSON"
      );
    }
  }
  if (type === "PHONE") requireField(effective.dialInfo, "dialInfo");
}

function hasPerGuestField(g: GuestInput) {
  if (g.appearanceType === "ONLINE") return !!g.joinUrl?.trim();
  if (g.appearanceType === "IN_PERSON")
    return !!(g.venueName?.trim() || g.venueAddress?.trim());
  if (g.appearanceType === "PHONE") return !!g.dialInfo?.trim();
  return false;
}

function validatePerGuestGuests(guests: GuestInput[]) {
  if (!Array.isArray(guests) || guests.length === 0) {
    throw new Error(
      "At least one guest is required when appearanceScope=PER_GUEST"
    );
  }
}

function validatePerGuestFallbacks(
  guests: GuestInput[],
  provisioning: AccessProvisioning,
  effectiveDefaults: {
    locationUrl?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    dialInfo?: string | null;
  }
) {
  const shared = provisioning === "SHARED";
  for (const g of guests) {
    const hasOwn = hasPerGuestField(g);
    if (hasOwn) continue;

    if (!shared) {
      throw new Error(
        `Guest "${g.name}" is missing required access detail for ${g.appearanceType} and accessProvisioning is PER_GUEST`
      );
    }
    if (
      g.appearanceType === "ONLINE" &&
      !effectiveDefaults.locationUrl?.trim()
    ) {
      throw new Error(
        `Guest "${g.name}" requires joinUrl or a booking default locationUrl`
      );
    }
    if (
      g.appearanceType === "IN_PERSON" &&
      !(
        (effectiveDefaults.locationName &&
          effectiveDefaults.locationName.trim()) ||
        (effectiveDefaults.locationAddress &&
          effectiveDefaults.locationAddress.trim())
      )
    ) {
      throw new Error(
        `Guest "${g.name}" requires venue fields or booking default locationName/locationAddress`
      );
    }
    if (g.appearanceType === "PHONE" && !effectiveDefaults.dialInfo?.trim()) {
      throw new Error(
        `Guest "${g.name}" requires dialInfo or booking default dialInfo`
      );
    }
  }
}

function sanitizeGuests(guests: GuestInput[]): GuestInput[] {
  return (guests ?? [])
    .map((g, idx) => ({
      ...g,
      order: typeof g.order === "number" ? g.order : idx,
      userId: g.userId ?? null,
      joinUrl: g.joinUrl?.trim() || null,
      venueName: g.venueName?.trim() || null,
      venueAddress: g.venueAddress?.trim() || null,
      dialInfo: g.dialInfo?.trim() || null,
      name: (g.name ?? "").trim(),
    }))
    .sort((a, b) => a.order - b.order);
}

/** ===== GET ===== */
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
      select: {
        id: true,
        orgId: true,
        subject: true,
        newsroomName: true,
        programName: true,
        hostName: true,
        hostUserId: true,
        talkingPoints: true,
        appearanceScope: true,
        appearanceType: true,
        accessProvisioning: true,
        locationUrl: true,
        locationName: true,
        locationAddress: true,
        dialInfo: true,
        expertUserId: true,
        expertName: true,
        startAt: true,
        durationMins: true,
        status: true,
      },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const isStaff = canEditBooking(viewer, booking.orgId);

    let isHost = false;
    if (TENANCY_ON && booking.orgId && viewer.userId) {
      const hostRow = await prisma.organizationMembership.findFirst({
        where: {
          orgId: booking.orgId,
          userId: viewer.userId,
          role: "HOST" as any,
        },
        select: { id: true },
      });
      isHost = !!hostRow;
    }

    const isExpert =
      (!!viewer.userId && booking.expertUserId === viewer.userId) ||
      (!!viewer.name && booking.expertName === viewer.name);

    const isGuest = viewer.userId
      ? !!(await (prisma as any).bookingGuest.findFirst({
          where: { bookingId: booking.id, userId: viewer.userId },
          select: { id: true },
        }))
      : false;

    const canRead = isStaff || isHost || isExpert || isGuest;
    if (!canRead) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const guests = await (prisma as any).bookingGuest.findMany({
      where: { bookingId: booking.id },
      orderBy: { order: "asc" },
    });

    const canEdit = canEditBooking(viewer, booking.orgId);
    return NextResponse.json({
      ok: true,
      booking: { ...booking, guests },
      canEdit,
    });
  } catch (err) {
    console.error("GET /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

/** ===== PATCH/PUT ===== */
async function updateBooking(id: string, body: UpdatePayload) {
  const current = await prisma.booking.findUnique({ where: { id } });
  if (!current) throw new Error("Not found");

  // Effective scope/type/provisioning
  const scope: AppearanceScope =
    body.appearanceScope ?? (current.appearanceScope as AppearanceScope);
  const provisioning: AccessProvisioning =
    body.accessProvisioning ??
    (current.accessProvisioning as AccessProvisioning);
  const unifiedType: AppearanceType | null =
    scope === "UNIFIED"
      ? body.appearanceType ??
        (current.appearanceType as AppearanceType | null) ??
        null
      : null;

  // Effective booking defaults (used in validation & later save)
  const effectiveDefaults = {
    locationUrl:
      body.locationUrl !== undefined
        ? body.locationUrl ?? null
        : current.locationUrl,
    locationName:
      body.locationName !== undefined
        ? body.locationName ?? null
        : current.locationName,
    locationAddress:
      body.locationAddress !== undefined
        ? body.locationAddress ?? null
        : current.locationAddress,
    dialInfo:
      body.dialInfo !== undefined ? body.dialInfo ?? null : current.dialInfo,
  };

  // Guests (sanitized) if provided
  const nextGuests = Array.isArray(body.guests)
    ? sanitizeGuests(body.guests)
    : undefined;

  // ---- Validation against EFFECTIVE values ----
  validateUnified(scope, unifiedType, effectiveDefaults);
  // Validate PER_GUEST only when caller replaces guests
  if (scope === "PER_GUEST" && nextGuests !== undefined) {
    validatePerGuestGuests(nextGuests);
    validatePerGuestFallbacks(nextGuests, provisioning, effectiveDefaults);
  }

  return await prisma.$transaction(async (tx) => {
    // ---------- Host mirroring ----------
    const nextHostUserId =
      body.hostUserId !== undefined
        ? body.hostUserId || null
        : current.hostUserId ?? null;

    let nextHostName: string | null;
    if (body.hostUserId !== undefined) {
      if (body.hostUserId === null) {
        nextHostName = null;
      } else if (body.hostName !== undefined) {
        nextHostName = (body.hostName ?? "").trim() || null;
      } else {
        const u = await (tx as any).user.findUnique({
          where: { id: body.hostUserId },
          select: { name: true },
        });
        nextHostName = (u?.name ?? "").trim() || null;
      }
    } else {
      nextHostName =
        body.hostName !== undefined
          ? (body.hostName ?? "").trim() || null
          : current.hostName ?? null;
    }

    // 1) Update booking core
    await tx.booking.update({
      where: { id },
      data: {
        subject: body.subject ?? current.subject,
        newsroomName:
          body.newsroomName !== undefined
            ? body.newsroomName
            : current.newsroomName,
        programName:
          body.programName !== undefined
            ? body.programName
            : current.programName,

        hostUserId: nextHostUserId,
        hostName: nextHostName,

        talkingPoints:
          body.talkingPoints !== undefined
            ? body.talkingPoints
            : current.talkingPoints,

        appearanceScope: scope,
        accessProvisioning: provisioning,
        appearanceType: scope === "UNIFIED" ? (unifiedType as any) : null,

        locationUrl: effectiveDefaults.locationUrl,
        locationName: effectiveDefaults.locationName,
        locationAddress: effectiveDefaults.locationAddress,
        dialInfo: effectiveDefaults.dialInfo,
      } as any,
    });

    // 2) Replace guests if provided
    if (nextGuests) {
      const ptx = tx as any;

      await ptx.bookingGuest.deleteMany({ where: { bookingId: id } });

      if (nextGuests.length) {
        await ptx.bookingGuest.createMany({
          data: nextGuests.map((g) => ({
            bookingId: id,
            userId: g.userId ?? null,
            name: g.name || "", // non-null column protection
            kind: g.kind,
            order: g.order,
            appearanceType: g.appearanceType,
            joinUrl: g.joinUrl ?? null,
            venueName: g.venueName ?? null,
            venueAddress: g.venueAddress ?? null,
            dialInfo: g.dialInfo ?? null,
          })),
        });
      }

      // 2b) Legacy mirror from first guest (FK-safe + non-null string)
      let mirrorExpertUserId: string | null = null;
      let mirrorExpertName: string = ""; // string (non-null)

      const firstInternal = nextGuests.find((g) => !!g.userId) || null;
      const firstAny = nextGuests[0];

      if (firstInternal?.userId) {
        const u = await (tx as any).user.findUnique({
          where: { id: firstInternal.userId },
          select: { id: true, name: true },
        });
        if (u?.id) {
          mirrorExpertUserId = u.id;
          const candidate =
            (firstInternal.name || "").trim() || (u.name || "").trim();
          mirrorExpertName = candidate || "";
        } else {
          mirrorExpertUserId = null;
          mirrorExpertName = (firstInternal.name || "").trim() || "";
        }
      } else if (firstAny) {
        mirrorExpertUserId = null;
        mirrorExpertName = (firstAny.name || "").trim() || "";
      } else {
        mirrorExpertUserId = null;
        mirrorExpertName = ""; // no guests → empty string
      }

      await tx.booking.update({
        where: { id },
        data: {
          expertUserId: mirrorExpertUserId,
          expertName: mirrorExpertName, // never null
        },
      });
    }

    // 3) Read back
    const updated = await tx.booking.findUnique({ where: { id } });
    const guests = await (tx as any).bookingGuest.findMany({
      where: { bookingId: id },
      orderBy: { order: "asc" },
    });
    return { ...updated!, guests };
  });
}

async function handleWrite(req: NextRequest, params: { id: string }) {
  const viewer = await resolveViewerFromRequest(req);
  if (!viewer.isSignedIn) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const bk = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!bk)
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 }
    );

  if (!canEditBooking(viewer, bk.orgId)) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 }
    );
  }

  let body: UpdatePayload;
  try {
    body = (await req.json()) as UpdatePayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  try {
    const updated = await updateBooking(params.id, body);
    return NextResponse.json({ ok: true, booking: updated });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (
      msg.includes("Missing required") ||
      msg.includes("requires") ||
      msg.includes("appearanceType is required")
    ) {
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }
    if (msg.includes("Foreign key constraint") || msg.includes("P2003")) {
      return NextResponse.json(
        { ok: false, error: "One or more user references are invalid." },
        { status: 400 }
      );
    }
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { ok: false, error: "Duplicate internal guest in the same booking." },
        { status: 400 }
      );
    }
    console.error("PATCH/PUT /api/bookings/[id] failed:", e);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  return handleWrite(req, ctx.params);
}
export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  return handleWrite(req, ctx.params);
}
