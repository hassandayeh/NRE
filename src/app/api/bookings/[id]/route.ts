// src/app/api/bookings/[id]/route.ts

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import prisma from "../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  buildBookingReadWhere,
  TENANCY_ON,
  canEditBooking,
} from "../../../../lib/viewer";

// ===== Types =====
type Params = { params: { id: string } };

/**
 * Only fields we explicitly allow to update.
 * NOTE: expertName/newsroomName are non-nullable in Prisma → if client sends null/empty we omit.
 */
const UPDATABLE_FIELDS = [
  "subject",
  "newsroomName",
  "expertName", // temporary until FK migration lands
  "appearanceType",
  "startAt",
  "durationMins",
  "programName",
  "hostName",
  "talkingPoints",
  "locationName",
  "locationUrl",
] as const;

type UpdatePayload = Partial<{
  subject: string; // non-nullable
  newsroomName: string; // non-nullable
  expertName: string; // non-nullable
  appearanceType: "ONLINE" | "IN_PERSON";
  startAt: Date;
  durationMins: number;
  programName: string | null;
  hostName: string | null;
  talkingPoints: string | null;
  locationName: string | null;
  locationUrl: string | null;
}>;

/** Map body → prisma-safe update payload (whitelist + coercions + null normalization). */
async function readUpdatePayload(req: Request): Promise<UpdatePayload> {
  const body = (await req.json().catch(() => ({} as any))) as Record<
    string,
    unknown
  >;

  const raw: Record<string, unknown> = {};

  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      let v = (body as any)[key];

      if (key === "startAt") {
        const d = new Date(v as any);
        if (!isNaN(d.getTime())) v = d;
        else continue;
      } else if (key === "durationMins") {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        v = n;
      }

      if (v === "") v = null; // normalize empty → null for nullable fields
      raw[key] = v;
    }
  }

  // Non-nullable fields: if null, omit to satisfy Prisma
  for (const k of ["subject", "expertName", "newsroomName"]) {
    if (raw[k] === null) delete raw[k];
  }

  return raw as UpdatePayload;
}

/** Basic field sanity checks (pre-Zod). */
function validateUpdatePayload(data: UpdatePayload) {
  if (
    data.durationMins !== undefined &&
    typeof data.durationMins !== "number"
  ) {
    return "durationMins must be a number";
  }
  if (data.durationMins !== undefined && data.durationMins <= 0) {
    return "durationMins must be > 0";
  }
  return null;
}

// ---------- GET /api/bookings/[id] ----------
export async function GET(req: Request, { params }: Params) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Staff can read within their orgs; Experts can read only if assigned (via expertName)
    const where = buildBookingReadWhere(params.id, viewer, TENANCY_ON);
    const booking = await prisma.booking.findFirst({ where });

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    // NEW: surface a computed canEdit for the client (back-compat: still returning { ok, booking })
    const canEdit = TENANCY_ON
      ? canEditBooking(viewer, booking.orgId ?? null)
      : viewer.staffOrgIds.length > 0;

    return NextResponse.json({ ok: true, booking, canEdit }, { status: 200 });
  } catch (err) {
    console.error("GET /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load booking" },
      { status: 500 }
    );
  }
}

// ---------- PATCH /api/bookings/[id] ----------
export async function PATCH(req: Request, { params }: Params) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Only newsroom staff (Owner/Admin/Producer) may update (enforced tenancy)
    if (TENANCY_ON && viewer.staffOrgIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const data = await readUpdatePayload(req);
    const validationError = validateUpdatePayload(data);
    if (validationError) {
      return NextResponse.json(
        { ok: false, error: validationError },
        { status: 400 }
      );
    }

    // Update by id; confirm org after update to block cross-tenant edits
    const updated = await prisma.booking.update({
      where: { id: params.id },
      data,
    });

    if (TENANCY_ON && !canEditBooking(viewer, updated.orgId ?? null)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    revalidateTag("bookings");
    return NextResponse.json({ ok: true, booking: updated }, { status: 200 });
  } catch (err) {
    console.error("PATCH /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update booking" },
      { status: 500 }
    );
  }
}

// Keep supporting PUT by delegating to PATCH semantics.
export async function PUT(req: Request, ctx: Params) {
  return PATCH(req, ctx);
}

// ---------- DELETE /api/bookings/[id] ----------
export async function DELETE(req: Request, { params }: Params) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer.isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Only newsroom staff can delete (enforced tenancy)
    if (TENANCY_ON && viewer.staffOrgIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
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

    if (TENANCY_ON && !canEditBooking(viewer, existing.orgId ?? null)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    await prisma.booking.delete({ where: { id: params.id } });
    revalidateTag("bookings");
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("DELETE /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to delete booking" },
      { status: 500 }
    );
  }
}
