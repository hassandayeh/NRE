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
type HostAppearanceScope = "UNIFIED" | "PER_HOST";
type HostAccessProvisioning = "SHARED" | "PER_HOST";
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

type HostInput = {
  id?: string;
  userId?: string | null;
  name: string;
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

  // Host (legacy mirrors remain supported)
  hostName: string | null;
  hostUserId: string | null;

  talkingPoints: string | null;

  // Guests model (existing)
  appearanceScope: AppearanceScope;
  appearanceType?: AppearanceType | null; // when UNIFIED
  accessProvisioning: AccessProvisioning;

  // Booking defaults for guests
  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  // Hosts dual model (new)
  hostAppearanceScope: HostAppearanceScope;
  hostAppearanceType?: AppearanceType | null; // when UNIFIED
  hostAccessProvisioning: HostAccessProvisioning;

  hostLocationUrl?: string | null;
  hostLocationName?: string | null;
  hostLocationAddress?: string | null;
  hostDialInfo?: string | null;

  // Full replace (optional)
  guests: GuestInput[];
  hosts: HostInput[];
}>;

/** ===== Helpers (shared) ===== */
function requireField(val: any, name: string) {
  if (val == null || (typeof val === "string" && val.trim().length === 0)) {
    throw new Error(`Missing required field: ${name}`);
  }
}

// ⬇️ CHANGED: only enforce booking-level defaults when provisioning === SHARED
function validateUnified(
  scope: AppearanceScope,
  type: AppearanceType | null | undefined,
  effective: {
    locationUrl?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    dialInfo?: string | null;
  },
  provisioning: AccessProvisioning
) {
  if (scope !== "UNIFIED") return;
  if (!type)
    throw new Error("appearanceType is required when appearanceScope=UNIFIED");

  // Only SHARED needs booking-level defaults; PER_GUEST uses per-guest fields.
  if (provisioning !== "SHARED") return;

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

function hasPerAccessField(p: {
  appearanceType: AppearanceType;
  joinUrl?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  dialInfo?: string | null;
}) {
  if (p.appearanceType === "ONLINE") return !!p.joinUrl?.trim();
  if (p.appearanceType === "IN_PERSON")
    return !!(p.venueName?.trim() || p.venueAddress?.trim());
  if (p.appearanceType === "PHONE") return !!p.dialInfo?.trim();
  return false;
}

function validatePerParticipantFallbacks(
  items: Array<{
    name: string;
    appearanceType: AppearanceType;
    joinUrl?: string | null;
    venueName?: string | null;
    venueAddress?: string | null;
    dialInfo?: string | null;
  }>,
  provisioning: AccessProvisioning,
  effectiveDefaults: {
    locationUrl?: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    dialInfo?: string | null;
  },
  label: "Guest" | "Host"
) {
  const shared = provisioning === "SHARED";
  for (const it of items) {
    const hasOwn = hasPerAccessField(it);
    if (hasOwn) continue;

    if (!shared) {
      throw new Error(
        `${label} "${it.name}" is missing required access detail for ${it.appearanceType} and accessProvisioning is PER_GUEST`
      );
    }

    if (
      it.appearanceType === "ONLINE" &&
      !effectiveDefaults.locationUrl?.trim()
    )
      throw new Error(
        `${label} "${it.name}" requires joinUrl or a booking default locationUrl`
      );

    if (
      it.appearanceType === "IN_PERSON" &&
      !(
        (effectiveDefaults.locationName &&
          effectiveDefaults.locationName.trim()) ||
        (effectiveDefaults.locationAddress &&
          effectiveDefaults.locationAddress.trim())
      )
    ) {
      throw new Error(
        `${label} "${it.name}" requires venue fields or booking default locationName/locationAddress`
      );
    }

    if (it.appearanceType === "PHONE" && !effectiveDefaults.dialInfo?.trim()) {
      throw new Error(
        `${label} "${it.name}" requires dialInfo or booking default dialInfo`
      );
    }
  }
}

/** ===== Hosts model helpers (dual) ===== */
function validateHostModel(
  hostScope: HostAppearanceScope,
  hostType: AppearanceType | null | undefined,
  hostProvisioning: HostAccessProvisioning,
  hostDefaults: {
    hostLocationUrl?: string | null;
    hostLocationName?: string | null;
    hostLocationAddress?: string | null;
    hostDialInfo?: string | null;
  },
  nextHosts: HostInput[] | undefined
) {
  if (hostScope === "UNIFIED") {
    if (!hostType)
      throw new Error(
        "hostAppearanceType is required when hostAppearanceScope=UNIFIED"
      );
    if (hostProvisioning === "SHARED") {
      if (hostType === "ONLINE")
        requireField(hostDefaults.hostLocationUrl, "hostLocationUrl");
      if (hostType === "IN_PERSON") {
        const ok =
          (hostDefaults.hostLocationName &&
            hostDefaults.hostLocationName.trim()) ||
          (hostDefaults.hostLocationAddress &&
            hostDefaults.hostLocationAddress.trim());
        if (!ok)
          throw new Error(
            "hostLocationName or hostLocationAddress is required when hosts are UNIFIED+SHARED+IN_PERSON"
          );
      }
      if (hostType === "PHONE")
        requireField(hostDefaults.hostDialInfo, "hostDialInfo");
    } else {
      if (nextHosts) {
        for (const h of nextHosts) {
          if (hostType === "ONLINE" && !String(h.joinUrl ?? "").trim())
            throw new Error(
              `Host "${h.name}" requires joinUrl when hosts are UNIFIED+PER_HOST (ONLINE)`
            );
          if (hostType === "IN_PERSON") {
            const vn = String(h.venueName ?? "").trim();
            const va = String(h.venueAddress ?? "").trim();
            if (!vn && !va)
              throw new Error(
                `Host "${h.name}" requires venueName or venueAddress when hosts are UNIFIED+PER_HOST (IN_PERSON)`
              );
          }
          if (hostType === "PHONE" && !String(h.dialInfo ?? "").trim())
            throw new Error(
              `Host "${h.name}" requires dialInfo when hosts are UNIFIED+PER_HOST (PHONE)`
            );
        }
      }
    }
  } else {
    if (hostProvisioning !== "PER_HOST") {
      throw new Error(
        "hostAccessProvisioning must be PER_HOST when hostAppearanceScope=PER_HOST"
      );
    }
    if (nextHosts) {
      for (const h of nextHosts) {
        if (h.appearanceType === "ONLINE" && !String(h.joinUrl ?? "").trim())
          throw new Error(
            `Host "${h.name}" requires joinUrl (PER_HOST, ONLINE)`
          );
        if (h.appearanceType === "IN_PERSON") {
          const vn = String(h.venueName ?? "").trim();
          const va = String(h.venueAddress ?? "").trim();
          if (!vn && !va)
            throw new Error(
              `Host "${h.name}" requires venueName or venueAddress (PER_HOST, IN_PERSON)`
            );
        }
        if (h.appearanceType === "PHONE" && !String(h.dialInfo ?? "").trim())
          throw new Error(
            `Host "${h.name}" requires dialInfo (PER_HOST, PHONE)`
          );
      }
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

function sanitizeHosts(hosts: HostInput[]): HostInput[] {
  return (hosts ?? [])
    .map((h, idx) => ({
      ...h,
      order: typeof h.order === "number" ? h.order : idx,
      userId: h.userId ?? null,
      joinUrl: h.joinUrl?.trim() || null,
      venueName: h.venueName?.trim() || null,
      venueAddress: h.venueAddress?.trim() || null,
      dialInfo: h.dialInfo?.trim() || null,
      name: (h.name ?? "").trim(),
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

        // Guests model
        appearanceScope: true,
        appearanceType: true,
        accessProvisioning: true,
        locationUrl: true,
        locationName: true,
        locationAddress: true,
        dialInfo: true,

        // Host dual model (new)
        hostAppearanceScope: true,
        hostAppearanceType: true,
        hostAccessProvisioning: true,
        hostLocationUrl: true,
        hostLocationName: true,
        hostLocationAddress: true,
        hostDialInfo: true,

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

    const hosts = await (prisma as any).bookingHost.findMany({
      where: { bookingId: booking.id },
      orderBy: { order: "asc" },
    });

    const canEdit = canEditBooking(viewer, booking.orgId);

    return NextResponse.json({
      ok: true,
      booking: { ...booking, guests, hosts },
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

  // ---------- Guests (existing) ----------
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

  const nextGuests = Array.isArray(body.guests)
    ? sanitizeGuests(body.guests)
    : undefined;

  // ⬇️ CHANGED: pass provisioning so UNIFIED+PER_GUEST doesn't require booking defaults
  validateUnified(scope, unifiedType, effectiveDefaults, provisioning);
  if (scope === "PER_GUEST") {
    if (nextGuests !== undefined) {
      if (!Array.isArray(nextGuests) || nextGuests.length === 0) {
        throw new Error(
          "At least one guest is required when appearanceScope=PER_GUEST"
        );
      }
      validatePerParticipantFallbacks(
        nextGuests,
        provisioning,
        effectiveDefaults,
        "Guest"
      );
    }
  } else if (scope === "UNIFIED" && provisioning === "PER_GUEST") {
    if (nextGuests !== undefined) {
      validatePerParticipantFallbacks(
        nextGuests.map((g) => ({ ...g, appearanceType: unifiedType! })),
        "PER_GUEST",
        effectiveDefaults,
        "Guest"
      );
    }
  }

  // ---------- Hosts (dual model) ----------
  const derivedHostScope: HostAppearanceScope =
    ((body.hostAppearanceScope ??
      (current.hostAppearanceScope as HostAppearanceScope | null)) as HostAppearanceScope | null) ??
    (scope === "PER_GUEST" ? "PER_HOST" : "UNIFIED");

  let derivedHostProvisioning: HostAccessProvisioning =
    ((body.hostAccessProvisioning ??
      (current.hostAccessProvisioning as HostAccessProvisioning | null)) as HostAccessProvisioning | null) ??
    (derivedHostScope === "PER_HOST"
      ? "PER_HOST"
      : provisioning === "PER_GUEST"
      ? "PER_HOST"
      : "SHARED");

  if (derivedHostScope === "PER_HOST") {
    derivedHostProvisioning = "PER_HOST";
  }

  const derivedHostType: AppearanceType | null =
    derivedHostScope === "UNIFIED"
      ? body.hostAppearanceType ??
        (current.hostAppearanceType as AppearanceType | null) ??
        body.appearanceType ??
        (current.appearanceType as AppearanceType | null) ??
        null
      : null;

  const hostDefaults = {
    hostLocationUrl:
      body.hostLocationUrl !== undefined
        ? body.hostLocationUrl ?? null
        : current.hostLocationUrl ?? current.locationUrl ?? null,
    hostLocationName:
      body.hostLocationName !== undefined
        ? body.hostLocationName ?? null
        : current.hostLocationName ?? current.locationName ?? null,
    hostLocationAddress:
      body.hostLocationAddress !== undefined
        ? body.hostLocationAddress ?? null
        : current.hostLocationAddress ?? current.locationAddress ?? null,
    hostDialInfo:
      body.hostDialInfo !== undefined
        ? body.hostDialInfo ?? null
        : current.hostDialInfo ?? current.dialInfo ?? null,
  };

  const nextHosts = Array.isArray(body.hosts)
    ? sanitizeHosts(body.hosts)
    : undefined;

  validateHostModel(
    derivedHostScope,
    derivedHostType,
    derivedHostProvisioning,
    hostDefaults,
    nextHosts
  );

  return await prisma.$transaction(async (tx) => {
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

        hostAppearanceScope: derivedHostScope as any,
        hostAccessProvisioning: derivedHostProvisioning as any,
        hostAppearanceType:
          derivedHostScope === "UNIFIED" ? (derivedHostType as any) : null,

        hostLocationUrl: hostDefaults.hostLocationUrl,
        hostLocationName: hostDefaults.hostLocationName,
        hostLocationAddress: hostDefaults.hostLocationAddress,
        hostDialInfo: hostDefaults.hostDialInfo,
      } as any,
    });

    if (nextGuests) {
      const ptx = tx as any;
      await ptx.bookingGuest.deleteMany({ where: { bookingId: id } });
      if (nextGuests.length) {
        await ptx.bookingGuest.createMany({
          data: nextGuests.map((g) => ({
            bookingId: id,
            userId: g.userId ?? null,
            name: g.name || "",
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

      let mirrorExpertUserId: string | null = null;
      let mirrorExpertName: string = "";
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
        mirrorExpertName = "";
      }

      await tx.booking.update({
        where: { id },
        data: {
          expertUserId: mirrorExpertUserId,
          expertName: mirrorExpertName,
        },
      });
    }

    if (nextHosts) {
      const ptx = tx as any;
      await ptx.bookingHost.deleteMany({ where: { bookingId: id } });

      const hostScopeNow = derivedHostScope;
      const hostProvNow = derivedHostProvisioning;
      const hostTypeNow = derivedHostType;

      if (nextHosts.length) {
        await ptx.bookingHost.createMany({
          data:
            hostScopeNow === "UNIFIED"
              ? nextHosts.map((h) => ({
                  bookingId: id,
                  userId: h.userId ?? null,
                  name: h.name || "",
                  order: h.order,
                  appearanceType: hostTypeNow!,
                  joinUrl:
                    hostProvNow === "PER_HOST" && hostTypeNow === "ONLINE"
                      ? h.joinUrl ?? null
                      : null,
                  venueName:
                    hostProvNow === "PER_HOST" && hostTypeNow === "IN_PERSON"
                      ? h.venueName ?? null
                      : null,
                  venueAddress:
                    hostProvNow === "PER_HOST" && hostTypeNow === "IN_PERSON"
                      ? h.venueAddress ?? null
                      : null,
                  dialInfo:
                    hostProvNow === "PER_HOST" && hostTypeNow === "PHONE"
                      ? h.dialInfo ?? null
                      : null,
                }))
              : nextHosts.map((h) => ({
                  bookingId: id,
                  userId: h.userId ?? null,
                  name: h.name || "",
                  order: h.order,
                  appearanceType: h.appearanceType,
                  joinUrl:
                    h.appearanceType === "ONLINE" ? h.joinUrl ?? null : null,
                  venueName:
                    h.appearanceType === "IN_PERSON"
                      ? h.venueName ?? null
                      : null,
                  venueAddress:
                    h.appearanceType === "IN_PERSON"
                      ? h.venueAddress ?? null
                      : null,
                  dialInfo:
                    h.appearanceType === "PHONE" ? h.dialInfo ?? null : null,
                })),
        });
      }

      let mirrorHostUserId: string | null = null;
      let mirrorHostName: string | null = null;

      const firstInternalH = nextHosts.find((h) => !!h.userId) || null;
      const firstAnyH = nextHosts[0];

      if (firstInternalH?.userId) {
        const u = await (tx as any).user.findUnique({
          where: { id: firstInternalH.userId },
          select: { id: true, name: true },
        });
        if (u?.id) {
          mirrorHostUserId = u.id;
          const candidate =
            (firstInternalH.name || "").trim() || (u.name || "").trim();
          mirrorHostName = candidate || null;
        } else {
          mirrorHostUserId = null;
          mirrorHostName = (firstInternalH.name || "").trim() || null;
        }
      } else if (firstAnyH) {
        mirrorHostUserId = null;
        mirrorHostName = (firstAnyH.name || "").trim() || null;
      } else {
        mirrorHostUserId = null;
        mirrorHostName = null;
      }

      await tx.booking.update({
        where: { id },
        data: {
          hostUserId: mirrorHostUserId,
          hostName: mirrorHostName,
        },
      });
    }

    const updated = await tx.booking.findUnique({ where: { id } });
    const guests = await (tx as any).bookingGuest.findMany({
      where: { bookingId: id },
      orderBy: { order: "asc" },
    });
    const hosts = await (tx as any).bookingHost.findMany({
      where: { bookingId: id },
      orderBy: { order: "asc" },
    });

    return { ...updated!, guests, hosts };
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

    // Explicit client errors (same style as guests)
    if (
      msg.includes("Missing required") ||
      msg.includes("requires") ||
      msg.includes("appearanceType is required") ||
      msg.includes("hostAppearanceType is required") ||
      msg.includes("hostAccessProvisioning must be PER_HOST")
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
        {
          ok: false,
          error: "Duplicate internal guest/host in the same booking.",
        },
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
