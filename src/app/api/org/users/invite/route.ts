// src/app/api/org/users/invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";
import { SignJWT } from "jose";

// App Router hints
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { error: string; code?: string };
function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
function badRequest(msg: string, code?: string) {
  return json({ error: msg, code } as JsonErr, { status: 400 });
}
function unauthorized() {
  return json({ error: "Unauthorized" } as JsonErr, { status: 401 });
}
function forbidden() {
  return json({ error: "Forbidden" } as JsonErr, { status: 403 });
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

/**
 * Ensure we have a valid org for the acting user.
 * If requested orgId is missing OR the user isn't a member of it,
 * and the user belongs to exactly one org, auto-select that org.
 * Returns null if still ambiguous.
 */
async function resolveOrgForUser(
  requestedOrgId: string | null,
  userId: string
): Promise<string | null> {
  if (requestedOrgId) {
    const member = await prisma.userRole.findUnique({
      where: { userId_orgId: { userId, orgId: requestedOrgId } },
      select: { userId: true },
    });
    if (member) return requestedOrgId; // valid request
  }

  const memberships = await prisma.userRole.findMany({
    where: { userId },
    select: { orgId: true },
    take: 2,
  });
  if (memberships.length === 1) return memberships[0].orgId;

  return null;
}

/** Create a signed invite token (JWT HS256) understood by /auth/invite/accept */
async function createInviteToken(
  payload: Record<string, any>
): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    // In dev we still sign the token to keep the flow testable.
    // In prod, NEXTAUTH_SECRET should always be set.
    console.warn(
      "[invite] Missing NEXTAUTH_SECRET; using ephemeral dev secret"
    );
  }
  const key = new TextEncoder().encode(secret || "dev-secret");
  // Default validity = 7 days
  const expiresIn = payload.expiresIn ?? "7d";

  const token = await new SignJWT({
    ...payload,
    t: "org-invite",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);

  return token;
}

/**
 * POST /api/org/users/invite?orgId=...
 * Body: { email: string, name?: string, slot?: 1..10 }
 *
 * Behavior (no auto-add):
 *  - If user is ALREADY a member of this org -> 200 { status: "already_member" }
 *  - Else -> always return an invite link to /auth/invite/accept?token=...
 *     * Existing account:   201 { status: "invite_created_existing", invitePath, path }
 *     * New email account:  201 { status: "invite_created_new",      invitePath, path }
 *
 * Notes:
 *  - We keep response keys friendly. `invitePath` is explicit, `path` is kept
 *    for maximum UI compatibility with older code that may read a generic "path".
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedOrgId = (searchParams.get("orgId") || "").trim() || null;

  // AuthN
  const session = await getServerSession(authOptions);
  const actingUserId = (session?.user as any)?.id as string | undefined;
  if (!actingUserId) return unauthorized();

  // Resolve org (robust to wrong/missing orgId)
  const orgId = await resolveOrgForUser(requestedOrgId, actingUserId);
  if (!orgId) return badRequest("Missing or invalid orgId");

  // AuthZ
  const ok = await hasPermission(orgId, actingUserId, "settings:manage");
  if (!ok) return forbidden();

  // Parse body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const rawEmail = (body?.email ?? "").trim().toLowerCase();
  const displayName =
    typeof body?.name === "string" ? body.name.trim() : undefined;

  if (!rawEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
    return badRequest("Valid 'email' is required");
  }

  // Resolve slot
  let slot: number | undefined = Number.isFinite(body?.slot)
    ? Number(body.slot)
    : undefined;
  if (!slot && typeof body?.orgRoleKey === "string") {
    const m = /^role(10|[1-9])$/i.exec(body.orgRoleKey);
    if (m) slot = Number(m[1]);
  }
  if (!slot) slot = 6; // non-privileged sensible default
  if (!Number.isFinite(slot) || slot < 1 || slot > 10) {
    return badRequest("Invalid 'slot' (must be 1..10)");
  }

  // Look up an existing account (case-insensitive)
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: rawEmail, mode: "insensitive" } },
    select: { id: true },
  });

  // Already a member of this org?
  if (existingUser) {
    const already = await prisma.userRole.findUnique({
      where: { userId_orgId: { userId: existingUser.id, orgId } },
      select: { userId: true },
    });
    if (already) {
      return json({ status: "already_member" }, { status: 200 });
    }
  }

  // Always create an invite token (no auto-add)
  const token = await createInviteToken({
    orgId,
    email: rawEmail,
    slot,
    // Optional niceties for the accept page
    name: displayName || null,
  });

  const invitePath = `/auth/invite/accept?token=${encodeURIComponent(token)}`;

  return json(
    {
      status: existingUser ? "invite_created_existing" : "invite_created_new",
      invitePath,
      // For max UI compatibility if some code expects `path`
      path: invitePath,
    },
    { status: 201 }
  );
}
