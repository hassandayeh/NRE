// src/app/api/org/users/[userId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";

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
function notFound(msg = "Not found") {
  return NextResponse.json<JsonErr>({ error: msg }, { status: 404 });
}

/** Shared: check org-scoped permission using org overrides then template fallback */
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

function isValidSlot(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: { userId: string } }
) {
  const targetUserId = (ctx.params?.userId || "").trim();
  if (!targetUserId) return badRequest("Missing userId param.");

  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) return badRequest("Missing orgId.");

  // AuthN
  const session = await getServerSession(authOptions);
  const actorUserId = (session?.user as any)?.id as string | undefined;
  if (!actorUserId) return unauthorized();

  // AuthZ
  const ok = await hasPermission(orgId, actorUserId, "settings:manage");
  if (!ok) return forbidden();

  // Parse JSON body
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return badRequest("Body must be JSON with { slot }.");
  }

  // Accept { slot: number|null }
  const desiredSlot = body?.slot as number | null | undefined;
  if (typeof desiredSlot !== "number" && desiredSlot !== null) {
    return badRequest(
      "Provide { slot: 1..10 } to move, or { slot: null } to remove membership."
    );
  }

  // Ensure the target membership exists (for update/remove flows)
  const existing = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: targetUserId, orgId } },
    include: {
      user: { select: { id: true, displayName: true, email: true } },
    },
  });

  if (desiredSlot === null) {
    // Remove membership
    if (!existing) return notFound("Membership not found.");
    await prisma.userRole.delete({
      where: { userId_orgId: { userId: targetUserId, orgId } },
    });
    return NextResponse.json({ removed: true });
  }

  // Move membership to another slot
  if (!isValidSlot(desiredSlot)) {
    return badRequest("slot must be an integer between 1 and 10.");
  }

  if (!existing) {
    // For now, only allow updating existing members (no seat-aware creates in this slice)
    return notFound(
      "Membership not found. Add user to org before changing slot."
    );
  }

  // Optional guard: allow moving even if destination orgRole is inactive; UI will reflect inactive
  const updated = await prisma.userRole.update({
    where: { userId_orgId: { userId: targetUserId, orgId } },
    data: { slot: desiredSlot },
    include: {
      user: { select: { id: true, displayName: true, email: true } },
      orgRole: { select: { label: true, isActive: true } },
    },
  });

  const item = {
    id: updated.user.id,
    name: updated.user.displayName || updated.user.email,
    email: updated.user.email,
    slot: updated.slot,
    roleLabel: updated.orgRole?.label ?? `Role ${updated.slot}`,
    roleActive: updated.orgRole?.isActive ?? false,
  };

  return NextResponse.json({ item });
}
