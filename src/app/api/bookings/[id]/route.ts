// src/app/api/bookings/[id]/route.ts

import { NextResponse, NextRequest } from "next/server";
import prisma from "../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  canEditBooking,
  TENANCY_ON,
} from "../../../../lib/viewer";

/** ===== Types (request payload) ===== */
type AppearanceType = "ONLINE" | "IN_PERSON" | "PHONE";
type AppearanceScope = "UNIFIED" | "PER_GUEST";
type AccessProvisioning = "SHARED" | "PER_GUEST";
type ParticipantKind = "EXPERT" | "REPORTER";

type GuestInput = {
  id?: string;
  userId?: string | null;
  name: string; // required for external guests
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
  hostName: string | null;
  hostUserId: string | null; // <-- FIRST-CLASS HOST (NEW)
  talkingPoints: string | null;

  appearanceScope: AppearanceScope;
  appearanceType?: AppearanceType | null; // only when UNIFIED
  accessProvisioning: AccessProvisioning;

  // Booking defaults
  locationUrl?: string | null; // ONLINE
  locationName?: string | null; // IN_PERSON
  locationAddress?: string | null;
  dialInfo?: string | null; // PHONE

  // Full replace of guests
  guests: GuestInput[];
}>;

/** ===== Validation helpers ===== */
function requireField(val: any, name: string) {
  if (!val || (typeof val === "string" && val.trim() === "")) {
    throw new Error(`Missing required field: ${name}`);
  }
}

function validateUnified(
  scope: AppearanceScope,
  type: AppearanceType | null | undefined,
  body: UpdatePayload
) {
  if (scope !== "UNIFIED") return;
  if (!type)
    throw new Error("appearanceType is required when appearanceScope=UNIFIED");

  if (type === "ONLINE") requireField(body.locationUrl, "locationUrl");

  if (
    type === "IN_PERSON" &&
    !(
      (body.locationName && body.locationName?.trim()) ||
      (body.locationAddress && body.locationAddress?.trim())
    )
  ) {
    throw new Error(
      "locationName or locationAddress is required when UNIFIED+IN_PERSON"
    );
  }

  if (type === "PHONE") requireField(body.dialInfo, "dialInfo");
}

function hasPerGuestField(g: GuestInput) {
  if (g.appearanceType === "ONLINE") return !!g.joinUrl?.trim();
  if (g.appearanceType === "IN_PERSON")
    return !!(g.venueName?.trim() || g.venueAddress?.trim());
  if (g.appearanceType === "PHONE") return !!g.dialInfo?.trim();
  return false;
}

function validatePerGuest(payload: UpdatePayload) {
  if (payload.appearanceScope !== "PER_GUEST") return;
  const guests: GuestInput[] = (payload.guests ?? []) as GuestInput[];
  if (!Array.isArray(guests) || guests.length === 0) {
    throw new Error(
      "At least one guest is required when appearanceScope=PER_GUEST"
    );
  }
}

function validateFallbacks(payload: UpdatePayload) {
  if (payload.appearanceScope !== "PER_GUEST") return;

  const guests: GuestInput[] = (payload.guests ?? []) as GuestInput[];
  const shared = payload.accessProvisioning === "SHARED";

  for (const g of guests) {
    const hasOwn = hasPerGuestField(g);
    if (hasOwn) continue;

    if (!shared) {
      throw new Error(
        `Guest "${g.name}" is missing required access detail for ${g.appearanceType} and accessProvisioning is PER_GUEST`
      );
    }

    if (g.appearanceType === "ONLINE" && !payload.locationUrl?.trim()) {
      throw new Error(
        `Guest "${g.name}" requires joinUrl or a booking default locationUrl`
      );
    }
    if (
      g.appearanceType === "IN_PERSON" &&
      !(
        (payload.locationName && payload.locationName.trim()) ||
        (payload.locationAddress && payload.locationAddress.trim())
      )
    ) {
      throw new Error(
        `Guest "${g.name}" requires venue fields or booking default locationName/locationAddress`
      );
    }
    if (g.appearanceType === "PHONE" && !payload.dialInfo?.trim()) {
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
      name: g.name?.trim() || "",
    }))
    .sort((a, b) => a.order - b.order);
}

/** ===== GET =====
 * Hosts are authorized for read via DB role check (no ViewerRole typing issues).
 */
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

    // 1) Load booking
    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        orgId: true,
        subject: true,
        newsroomName: true,
        programName: true,
        hostName: true,
        hostUserId: true, // <-- include host FK in response
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

    // 2) Authorization (read)
    const isStaff = canEditBooking(viewer, booking.orgId); // OWNER/ADMIN/PRODUCER
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
      (!!viewer.name && booking.expertName === viewer.name); // legacy fallback
    const isGuest = viewer.userId
      ? !!(await (prisma as any).bookingGuest.findFirst({
          where: { bookingId: booking.id, userId: viewer.userId },
          select: { id: true },
        }))
      : false;

    const canRead = isStaff || isHost || isExpert || isGuest;
    if (!canRead) {
      // Keep page UX the same: 404 when unauthorized
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    // 3) Load guests and respond
    const guests = await (prisma as any).bookingGuest.findMany({
      where: { bookingId: booking.id },
      orderBy: { order: "asc" },
    });

    const canEdit = canEditBooking(viewer, booking.orgId); // HOST stays read-only
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

/** ===== PATCH/PUT (update booking) ===== */

async function updateBooking(id: string, body: UpdatePayload) {
  const current = await prisma.booking.findUnique({ where: { id } });
  if (!current) throw new Error("Not found");

  // Read existing values to compute validation defaults
  const c: any = current;
  const scope: AppearanceScope =
    body.appearanceScope ?? (c.appearanceScope as AppearanceScope);
  const provisioning: AccessProvisioning =
    body.accessProvisioning ?? (c.accessProvisioning as AccessProvisioning);
  const unifiedType =
    scope === "UNIFIED"
      ? body.appearanceType ?? (c.appearanceType as AppearanceType | null)
      : null;

  const payload: UpdatePayload = {
    ...body,
    appearanceScope: scope,
    accessProvisioning: provisioning,
    appearanceType: unifiedType,
  };

  validateUnified(scope, unifiedType, payload);
  if (scope === "PER_GUEST") {
    validatePerGuest(payload);
    validateFallbacks(payload);
  }

  const nextGuests = Array.isArray(body.guests)
    ? sanitizeGuests(body.guests)
    : undefined;

  return await prisma.$transaction(async (tx) => {
    // 1) Update booking core fields (now includes hostUserId)
    await tx.booking.update({
      where: { id },
      data: {
        subject: body.subject ?? current.subject,
        newsroomName: body.newsroomName ?? current.newsroomName,
        programName: body.programName ?? current.programName,
        hostName: body.hostName ?? current.hostName,
        hostUserId:
          body.hostUserId !== undefined
            ? body.hostUserId || null
            : c.hostUserId ?? null,
        talkingPoints: body.talkingPoints ?? current.talkingPoints,

        appearanceScope: scope,
        accessProvisioning: provisioning,
        appearanceType: scope === "UNIFIED" ? (unifiedType as any) : null,

        locationUrl:
          body.locationUrl !== undefined
            ? body.locationUrl || null
            : c.locationUrl ?? null,
        locationName:
          body.locationName !== undefined
            ? body.locationName || null
            : c.locationName ?? null,
        locationAddress:
          body.locationAddress !== undefined
            ? body.locationAddress || null
            : c.locationAddress ?? null,
        dialInfo:
          body.dialInfo !== undefined
            ? body.dialInfo || null
            : c.dialInfo ?? null,
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
            name: g.name,
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

      // 3) Legacy mirror from first guest
      const first = nextGuests[0];
      await tx.booking.update({
        where: { id },
        data: {
          expertUserId: first?.userId ?? null,
          expertName: first?.name ?? current.expertName,
        },
      });
    }

    // 4) Read back
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

  // Must be newsroom staff of this booking's org to edit
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
    if (msg.includes("Missing required"))
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    if (msg.includes("requires"))
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
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
