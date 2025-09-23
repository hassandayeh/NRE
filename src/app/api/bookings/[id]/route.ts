// src/app/api/bookings/[id]/route.ts
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "../../../../lib/prisma";

// ===== Types =====
type Params = { params: { id: string } };
type Role = "OWNER" | "ADMIN" | "PRODUCER" | "EXPERT";
type RolesMap = Map<string, Role>;

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

/** Env flag: if set to the string "false", tenancy guards are bypassed (dev only). */
const TENANCY_ON = process.env.TENANCY_ENFORCED !== "false";

/**
 * Robust auth context for Route Handlers
 * 1) Try NextAuth session (getServerSession)
 * 2) Fallback to JWT (getToken) and hydrate minimal user from DB
 * Returns:
 * - rolesByOrg: map of all memberships
 * - staffOrgIds: all orgIds where user is OWNER/ADMIN/PRODUCER
 * - activeOrgId: from session/user (may be null)
 */
async function getAuthContext(request: Request) {
  // 1) Primary: session
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as any | undefined;

  const hydrate = async (userId: string, activeOrgId: string | null) => {
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId },
      select: { orgId: true, role: true },
    });

    const rolesByOrg: RolesMap = new Map();
    const staffOrgIds: string[] = [];

    for (const m of memberships) {
      const role = m.role as Role;
      rolesByOrg.set(m.orgId, role);
      if (role === "OWNER" || role === "ADMIN" || role === "PRODUCER") {
        staffOrgIds.push(m.orgId);
      }
    }

    return { memberships, rolesByOrg, staffOrgIds, activeOrgId };
  };

  if (sessionUser?.id) {
    const activeOrgId: string | null =
      (sessionUser.activeOrgId as string | null) ?? null;
    const ctx = await hydrate(sessionUser.id, activeOrgId);
    return { session, user: sessionUser, ...ctx, isSignedIn: true };
  }

  // 2) Fallback: JWT token (covers cases where getServerSession returns null)
  const token = await getToken({ req: request as any });
  if (token?.email || token?.sub) {
    const me =
      (token.email &&
        (await prisma.user.findUnique({
          where: { email: token.email },
          select: { id: true, email: true, name: true, activeOrgId: true },
        }))) ||
      (token.sub &&
        (await prisma.user.findUnique({
          where: { id: token.sub },
          select: { id: true, email: true, name: true, activeOrgId: true },
        })));

    if (me) {
      const ctx = await hydrate(me.id, me.activeOrgId ?? null);
      return { session: null, user: me, ...ctx, isSignedIn: true };
    }
  }

  // No auth
  return {
    session: null,
    user: undefined,
    activeOrgId: null as string | null,
    memberships: [] as Array<{ orgId: string; role: Role }>,
    rolesByOrg: new Map() as RolesMap,
    staffOrgIds: [] as string[],
    isSignedIn: false,
  };
}

/** Helper: any newsroom-staff membership? */
function hasAnyStaff(staffOrgIds: string[]) {
  return staffOrgIds.length > 0;
}

/**
 * Guard: build a Prisma where clause for the booking id based on caller identity.
 * - Staff: restrict by their staff orgs
 * - Expert: restrict by assigned expert (temporary: name match until FK migration)
 */
function buildGuardedWhere(opts: {
  id: string;
  enforce: boolean;
  staffOrgIds: string[];
  user: any | undefined;
}) {
  const { id, enforce, staffOrgIds, user } = opts;

  if (!enforce) {
    return { id }; // dev escape hatch
  }

  // Newsroom staff: allow any staff org the user belongs to
  if (hasAnyStaff(staffOrgIds)) {
    // If multiple orgs, matching booking.orgId will filter correctly
    return { id, orgId: { in: staffOrgIds } };
  }

  // Expert path (temporary until FK migration): match by their name
  const userName = (user?.name as string | undefined) ?? "__invalid__";
  return { id, expertName: userName };
}

/** Map body → prisma-safe update payload (whitelist + coercions + null normalization). */
async function readUpdatePayload(req: Request): Promise<UpdatePayload> {
  const body = (await req.json().catch(() => ({} as any))) as Record<
    string,
    unknown
  >;

  const raw: Record<string, any> = {};
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      let v = (body as any)[key];

      if (key === "startAt") {
        const d = new Date(v);
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
    const { isSignedIn, user, staffOrgIds } = await getAuthContext(req);

    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Staff can read within their orgs; Experts can read only if assigned (via expertName)
    const where = buildGuardedWhere({
      id: params.id,
      enforce: TENANCY_ON,
      staffOrgIds,
      user,
    });

    const booking = await prisma.booking.findFirst({ where });

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
    const { isSignedIn, staffOrgIds } = await getAuthContext(req);

    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Only newsroom staff (Owner/Admin/Producer) may update, and only within their staff orgs
    if (TENANCY_ON && !hasAnyStaff(staffOrgIds)) {
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

    if (
      TENANCY_ON &&
      (!updated.orgId || !staffOrgIds.includes(updated.orgId))
    ) {
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
    const { isSignedIn, staffOrgIds } = await getAuthContext(req);

    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Only newsroom staff can delete and only for bookings in their staff orgs
    if (TENANCY_ON && !hasAnyStaff(staffOrgIds)) {
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

    if (
      TENANCY_ON &&
      (!existing.orgId || !staffOrgIds.includes(existing.orgId))
    ) {
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
