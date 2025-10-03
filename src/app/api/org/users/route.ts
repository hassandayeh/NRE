// src/app/api/org/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import { randomBytes } from "crypto"; // NEW: to populate required hashedPassword

// Prisma-safe
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { error: string; code?: string };

function badRequest(msg: string, code?: string) {
  return NextResponse.json({ error: msg, code } as JsonErr, { status: 400 });
}
function unauthorized(msg = "Unauthorized") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 401 });
}
function forbidden(msg = "Forbidden") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 403 });
}

function parseIntParam(
  value: string | null,
  def: number,
  min: number,
  max: number
) {
  const n = value ? Number(value) : def;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Resolve whether user has a given permission in an org:
 * - Must have a membership (UserRole) in org
 * - OrgRole must be active
 * - If org override exists in OrgRolePermission -> use allowed
 * - Else fall back to RoleTemplatePermission presence (presence = allow)
 */
async function hasPermission(
  orgId: string,
  userId: string,
  key: string
): Promise<boolean> {
  const membership = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { slot: true },
  });
  if (!membership) return false;

  const slot = membership.slot;

  // Check org slot state + org override
  const orgRole = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot } },
    select: {
      isActive: true,
      permissions: {
        where: { permissionKey: { key } },
        select: { allowed: true },
        take: 1,
      },
    },
  });
  if (!orgRole || !orgRole.isActive) return false;
  const override = orgRole.permissions[0];
  if (override) return !!override.allowed;

  // Fall back to default template (presence = allow)
  const template = await prisma.roleTemplate.findUnique({
    where: { slot },
    select: {
      permissions: {
        where: { permissionKey: { key } },
        select: { permissionKeyId: true },
        take: 1,
      },
    },
  });
  return !!template?.permissions?.length;
}

/** ---------- GET (kept intact) ---------- */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) return badRequest("Missing orgId");

  // AuthN
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();

  // AuthZ (org-scoped settings read/manage)
  const ok = await hasPermission(orgId, userId, "settings:manage");
  if (!ok) return forbidden();

  // Filters & pagination
  const q = (searchParams.get("q") || "").trim();
  const slotParam = searchParams.get("slot");
  const slot = slotParam ? Number(slotParam) : undefined;

  const page = parseIntParam(searchParams.get("page"), 1, 1, 10_000);
  const pageSize = parseIntParam(searchParams.get("pageSize"), 20, 1, 100);

  const where: any = { orgId };
  if (Number.isFinite(slot)) where.slot = slot;

  const userWhere = q
    ? {
        OR: [
          { displayName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [total, rows] = await Promise.all([
    prisma.userRole.count({
      where: { ...where, ...(userWhere ? { user: userWhere } : {}) },
    }),
    prisma.userRole.findMany({
      where: { ...where, ...(userWhere ? { user: userWhere } : {}) },
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        orgRole: { select: { label: true, isActive: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((r) => ({
    id: r.user.id,
    name: r.user.displayName || r.user.email,
    email: r.user.email,
    slot: r.slot,
    roleLabel: r.orgRole?.label ?? `Role ${r.slot}`,
    roleActive: r.orgRole?.isActive ?? false,
  }));

  return NextResponse.json({ items, page, pageSize, total });
}

/** ---------- POST (org-owned staff creation) ----------
 * Create-or-add staff:
 * - If email/userId points to an existing user, add them to the org (idempotent).
 * - If email doesn't exist, CREATE a minimal staff account (org-owned) then add it.
 * - AuthZ: same as GET — requires `settings:manage` in this org.
 * - Idempotent: if already a member, returns 200 with the same shape.
 * - Slot: accept `slot` (1..10) OR `orgRoleKey` like "role3". Default = 6.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) return badRequest("Missing orgId");

  // AuthN
  const session = await getServerSession(authOptions);
  const actingUserId = (session?.user as any)?.id as string | undefined;
  if (!actingUserId) return unauthorized();

  // AuthZ (reuse same guard as GET)
  const ok = await hasPermission(orgId, actingUserId, "settings:manage");
  if (!ok) return forbidden();

  // Body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const rawEmail = (body?.email ?? "").trim();
  const rawUserId = (body?.userId ?? "").trim();
  const displayName =
    typeof body?.name === "string" ? body.name.trim() : undefined;

  if ((!rawEmail && !rawUserId) || (rawEmail && rawUserId)) {
    return badRequest("Provide exactly one of 'email' or 'userId'");
  }

  // Resolve slot
  let slot: number | undefined = Number.isFinite(body?.slot)
    ? Number(body.slot)
    : undefined;
  if (!slot && typeof body?.orgRoleKey === "string") {
    const m = /^role(10|[1-9])$/i.exec(body.orgRoleKey);
    if (m) slot = Number(m[1]);
  }
  if (!slot) slot = 6; // sensible non-privileged default
  if (!Number.isFinite(slot) || slot < 1 || slot > 10) {
    return badRequest("Invalid 'slot' (must be 1..10)");
  }

  // Find or create target user
  let targetUser = rawUserId
    ? await prisma.user.findUnique({
        where: { id: rawUserId },
        select: { id: true, email: true, displayName: true },
      })
    : await prisma.user.findFirst({
        where: { email: { equals: rawEmail, mode: "insensitive" } },
        select: { id: true, email: true, displayName: true },
      });

  if (!targetUser) {
    // Org-owned creation of a minimal staff account
    // NOTE: Your schema requires `hashedPassword` -> provide a safe placeholder.
    // This is NOT a usable password; invited users will set credentials later.
    const placeholderHash = `invited:${randomBytes(48).toString("hex")}`;
    targetUser = await prisma.user.create({
      data: {
        email: rawEmail,
        displayName: displayName || null,
        hashedPassword: placeholderHash, // <-- REQUIRED by your schema
      },
      select: { id: true, email: true, displayName: true },
    });
  }

  // Idempotent: already a member?
  const existing = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: targetUser.id, orgId } },
    include: {
      user: { select: { id: true, displayName: true, email: true } },
      orgRole: { select: { label: true, isActive: true } },
    },
  });

  if (existing) {
    const member = {
      id: existing.user.id,
      name: existing.user.displayName || existing.user.email,
      email: existing.user.email,
      slot: existing.slot,
      roleLabel: existing.orgRole?.label ?? `Role ${existing.slot}`,
      roleActive: existing.orgRole?.isActive ?? false,
    };
    return NextResponse.json({ member }, { status: 200 });
  }

  // Create membership
  const created = await prisma.userRole.create({
    data: {
      orgId,
      userId: targetUser.id,
      slot,
    },
    include: {
      user: { select: { id: true, displayName: true, email: true } },
      orgRole: { select: { label: true, isActive: true } },
    },
  });

  const member = {
    id: created.user.id,
    name: created.user.displayName || created.user.email,
    email: created.user.email,
    slot: created.slot,
    roleLabel: created.orgRole?.label ?? `Role ${created.slot}`,
    roleActive: created.orgRole?.isActive ?? false,
  };

  return NextResponse.json({ member }, { status: 201 });
}
