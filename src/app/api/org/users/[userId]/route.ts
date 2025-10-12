// src/app/api/org/users/[userId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";

export const runtime = "nodejs"; // Prisma-safe
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
function notFound(msg = "Not found") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 404 });
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
  return slotAllows(orgId, membership.slot, key);
}

/** Check if a slot effectively allows a permission in an org (active org role + override -> else template presence) */
async function slotAllows(
  orgId: string,
  slot: number,
  key: string
): Promise<boolean> {
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

  // Fallback to default template (presence = allow)
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

/** Count how many current members effectively have a given permission in this org */
async function countMembersWith(orgId: string, key: string): Promise<number> {
  const rows = await prisma.userRole.findMany({
    where: { orgId },
    select: { slot: true },
  });
  const cache = new Map<number, boolean>();
  let count = 0;
  for (const r of rows) {
    let allowed = cache.get(r.slot);
    if (allowed === undefined) {
      allowed = await slotAllows(orgId, r.slot, key);
      cache.set(r.slot, allowed);
    }
    if (allowed) count++;
  }
  return count;
}

function isValidSlot(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10;
}

/**
 * PATCH
 * Body:
 *  { slot: number }  -> move member to another slot
 *  { slot: null }    -> remove membership
 * Optional:
 *  { confirm: true } -> required when actor is changing their own membership in a way that removes their manager rights
 */
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

  // AuthZ: must be able to manage org settings today
  const canManage = await hasPermission(orgId, actorUserId, "settings:manage");
  if (!canManage) return forbidden();

  // Actor membership (for Role 1 policy)
  const actorMembership = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: actorUserId, orgId } },
    select: { slot: true },
  });
  const actorIsAdmin = (actorMembership?.slot ?? 0) === 1;

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

  // If removing, membership must exist
  if (desiredSlot === null) {
    if (!existing) return notFound("Membership not found.");

    // POLICY: Only Admin can remove a Role 1 member
    if (!actorIsAdmin && (existing.slot ?? 0) === 1) {
      return forbidden("Only Admin can remove a Role 1 member.");
    }

    // SAFETY RAILS ↓↓↓

    const managersNow = await countMembersWith(orgId, "settings:manage");
    const targetIsManager = await hasPermission(
      orgId,
      targetUserId,
      "settings:manage"
    );

    // Last-manager guard
    if (targetIsManager && managersNow === 1) {
      return NextResponse.json(
        {
          error: "Cannot remove the last member with settings:manage.",
          code: "LAST_MANAGER",
        } as JsonErr,
        { status: 409 }
      );
    }

    // Self-removal confirm
    if (
      actorUserId === targetUserId &&
      targetIsManager &&
      body?.confirm !== true
    ) {
      return badRequest(
        "Removing your own access requires confirm: true.",
        "CONFIRM_REQUIRED"
      );
    }
    // SAFETY RAILS ↑↑↑

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

  // SAFETY RAILS for demotion that removes manager rights ↓↓↓
  const managersNow = await countMembersWith(orgId, "settings:manage");
  const targetIsManager = await hasPermission(
    orgId,
    targetUserId,
    "settings:manage"
  );
  const targetWillBeManager = await slotAllows(
    orgId,
    desiredSlot,
    "settings:manage"
  );

  // Last-manager guard: moving from manager -> non-manager while being the last one
  if (targetIsManager && !targetWillBeManager && managersNow === 1) {
    return NextResponse.json(
      {
        error: "Cannot demote the last member with settings:manage.",
        code: "LAST_MANAGER",
      } as JsonErr,
      { status: 409 }
    );
  }

  // Self-demotion confirm
  if (
    actorUserId === targetUserId &&
    targetIsManager &&
    !targetWillBeManager &&
    body?.confirm !== true
  ) {
    return badRequest(
      "Demoting yourself out of settings:manage requires confirm: true.",
      "CONFIRM_REQUIRED"
    );
  }
  // SAFETY RAILS ↑↑↑

  // POLICY: Only Admin can (a) assign Role 1, or (b) change a Role 1 member's role
  if (!actorIsAdmin) {
    if (desiredSlot === 1) {
      return forbidden("Only Admin can assign Role 1.");
    }
    if ((existing.slot ?? 0) === 1) {
      return forbidden("Only Admin can change a Role 1 member's role.");
    }
  }

  // POLICY: destination slot must be active in this org
  const destOrgRole = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot: desiredSlot } },
    select: { isActive: true },
  });
  if (!destOrgRole || !destOrgRole.isActive) {
    return badRequest("Destination role is inactive.", "ROLE_INACTIVE");
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
