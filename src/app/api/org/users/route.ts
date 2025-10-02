// src/app/api/org/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";

export const runtime = "nodejs"; // Prisma-safe
export const dynamic = "force-dynamic";

type JsonErr = { error: string };

function badRequest(msg: string) {
  return NextResponse.json<JsonErr>({ error: msg }, { status: 400 });
}
function unauthorized(msg = "Unauthorized") {
  return NextResponse.json<JsonErr>({ error: msg }, { status: 401 });
}
function forbidden(msg = "Forbidden") {
  return NextResponse.json<JsonErr>({ error: msg }, { status: 403 });
}

/**
 * Resolve whether user has a given permission in an org:
 * - Must have a membership (UserRole) in org
 * - OrgRole must be active
 * - If org override exists in OrgRolePermission -> use allowed
 * - Else fall back to RoleTemplatePermission presence (allow if present)
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
