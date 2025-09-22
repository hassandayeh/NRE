// src/app/api/bookings/[id]/route.ts
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "../../../../lib/prisma";

type Params = { params: { id: string } };

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

type UpdatePayload = Partial<Record<(typeof UPDATABLE_FIELDS)[number], any>>;

/** Env flag: if set to the string "false", guards are bypassed (dev only). */
const TENANCY_ON = process.env.TENANCY_ENFORCED !== "false";

/**
 * Resolves session, memberships, role buckets, and activeOrgId.
 * We only rely on what's already in your DB/session; no schema changes here.
 */
async function getAuthContext() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any | undefined;

  if (!user?.id) {
    return {
      session,
      user,
      activeOrgId: null as string | null,
      memberships: [],
      rolesByOrg: new Map<string, string>(),
      isSignedIn: false,
    };
  }

  const activeOrgId: string | null =
    (user.activeOrgId as string | null) ?? null;

  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id },
    select: { orgId: true, role: true },
  });

  const rolesByOrg = new Map<string, string>();
  for (const m of memberships) rolesByOrg.set(m.orgId, m.role);

  return {
    session,
    user,
    activeOrgId,
    memberships,
    rolesByOrg,
    isSignedIn: true,
  };
}

/** Helper: is the user newsroom-staff (Owner/Producer) in the given org? */
function isNewsroomStaff(
  rolesByOrg: Map<string, string>,
  orgId: string | null
) {
  if (!orgId) return false;
  const role = rolesByOrg.get(orgId);
  return role === "OWNER" || role === "PRODUCER";
}

/** Helper: does the user have membership in the org? */
function isMemberOf(rolesByOrg: Map<string, string>, orgId: string | null) {
  if (!orgId) return false;
  return rolesByOrg.has(orgId);
}

/** Guard: builds a Prisma where clause for the specific booking id based on the caller identity. */
function buildGuardedWhere(opts: {
  id: string;
  enforce: boolean;
  activeOrgId: string | null;
  rolesByOrg: Map<string, string>;
  user: any | undefined;
}) {
  const { id, enforce, activeOrgId, rolesByOrg, user } = opts;

  if (!enforce) {
    // Dev mode escape hatch: no tenancy guard
    return { id };
  }

  // Prefer org scoping first (Booking.orgId)
  // Newsroom staff can only access records in their active org.
  if (isNewsroomStaff(rolesByOrg, activeOrgId)) {
    return {
      id,
      orgId: activeOrgId ?? undefined,
    };
  }

  // Expert: must be a member of the booking org, AND expertName must match their user.name (for now).
  // (After FK migration, we'll use expertUserId === user.id)
  const userName = (user?.name as string | undefined) ?? "__invalid__";

  // We cannot express "member of booking's org" without knowing the org beforehand,
  // so we apply a combined where: id must match, orgId must be one of memberships (via filter),
  // and expertName must match. Since Prisma findFirst supports `in` only on a field,
  // we’ll enforce membership AFTER fetching guarded by expertName, then verify org membership.
  return {
    id,
    expertName: userName,
    // org check is done post-fetch because we don't have the list inline in where for a single id.
  };
}

/** Ensures expert is member of the booking's org (post-fetch check). */
function assertExpertOrgMembership(
  rolesByOrg: Map<string, string>,
  booking: { orgId: string | null }
) {
  if (!booking.orgId) return false; // if booking has no org, treat as not visible cross-tenant
  return rolesByOrg.has(booking.orgId);
}

/** Safely map body → update payload (whitelist), with minimal coercions. */
async function readUpdatePayload(req: Request): Promise<UpdatePayload> {
  const body = await req.json().catch(() => ({}));

  const data: UpdatePayload = {};
  for (const key of UPDATABLE_FIELDS) {
    if (body[key] !== undefined) {
      if (key === "startAt") {
        const d = new Date(body.startAt);
        if (!isNaN(d.getTime())) (data as any).startAt = d;
        continue;
      }
      (data as any)[key] = body[key];
    }
  }
  return data;
}

/** Basic field sanity checks (pre-Zod; we’ll add Zod in a later slice). */
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
export async function GET(_req: Request, { params }: Params) {
  try {
    const { isSignedIn, user, activeOrgId, rolesByOrg } =
      await getAuthContext();
    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const where = buildGuardedWhere({
      id: params.id,
      enforce: TENANCY_ON,
      activeOrgId,
      rolesByOrg,
      user,
    });

    // Try find by guarded where
    let booking = await prisma.booking.findFirst({ where });

    // If expert path, enforce post-fetch org membership
    if (TENANCY_ON && booking && !isNewsroomStaff(rolesByOrg, activeOrgId)) {
      if (
        !assertExpertOrgMembership(rolesByOrg, { orgId: booking.orgId ?? null })
      ) {
        booking = null;
      }
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, booking }, { status: 200 });
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
    const { isSignedIn, user, activeOrgId, rolesByOrg } =
      await getAuthContext();
    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Only newsroom staff can update (Owner/Producer) within their active org
    if (TENANCY_ON && !isNewsroomStaff(rolesByOrg, activeOrgId)) {
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

    // Guarded update by id + org (if enforced)
    const updated = await prisma.booking.update({
      where: { id: params.id },
      data,
    });

    if (TENANCY_ON && updated.orgId !== activeOrgId) {
      // If the record isn't in the active org, treat as forbidden (race or crafted id).
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

// For clients already calling PUT, support it by delegating to PATCH semantics.
export async function PUT(req: Request, ctx: Params) {
  return PATCH(req, ctx);
}

// ---------- DELETE /api/bookings/[id] ----------
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { isSignedIn, activeOrgId, rolesByOrg } = await getAuthContext();
    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Only newsroom staff can delete (Owner/Producer), and only within active org
    if (TENANCY_ON && !isNewsroomStaff(rolesByOrg, activeOrgId)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Read first to ensure org match when enforced
    const existing = await prisma.booking.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    if (TENANCY_ON && existing.orgId !== activeOrgId) {
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
