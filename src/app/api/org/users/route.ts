// src/app/api/org/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import { randomBytes, createHmac } from "crypto";

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

/** ------------------------------------------------------------------------
 * Permission & org helpers
 * ---------------------------------------------------------------------- */

/** Check org-scoped permission (settings:manage umbrella) */
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

/** Resolve org to act on (robust to missing/wrong orgId) */
async function resolveOrgForUser(
  requestedOrgId: string | null,
  userId: string
): Promise<string | null> {
  if (requestedOrgId) {
    const member = await prisma.userRole.findUnique({
      where: { userId_orgId: { userId, orgId: requestedOrgId } },
      select: { userId: true },
    });
    if (member) return requestedOrgId;
  }
  const memberships = await prisma.userRole.findMany({
    where: { userId },
    select: { orgId: true },
    take: 2,
  });
  if (memberships.length === 1) return memberships[0].orgId;
  return null;
}

/** ------------------------------------------------------------------------
 * Tiny JWT (HS256) for invite links — no external deps
 * Matches /auth/invite/accept which expects a 3-part JWT-like token.
 * ---------------------------------------------------------------------- */
function b64url(buf: Buffer | string) {
  const b = Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function signHS256(header: any, payload: any, secret: string): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}
type InvitePayload = {
  typ: "invite";
  orgId: string;
  userId: string;
  email: string;
  iat: number;
  exp: number;
};
function makeInviteToken(origin: string, payload: InvitePayload) {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    // In dev, fail loudly so we notice
    throw new Error(
      "Missing NEXTAUTH_SECRET/AUTH_SECRET: required to sign invite tokens for /auth/invite/accept"
    );
  }
  return signHS256({ alg: "HS256", typ: "JWT" }, payload, secret);
}

/** ------------------------------------------------------------------------
 * GET: list members
 * ---------------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedOrgId = (searchParams.get("orgId") || "").trim() || null;

  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();

  const orgId = await resolveOrgForUser(requestedOrgId, userId);
  if (!orgId) return badRequest("Missing or invalid orgId");

  const ok = await hasPermission(orgId, userId, "settings:manage");
  if (!ok) return forbidden();

  const q = (searchParams.get("q") || "").trim();
  const slotParam = searchParams.get("slot");
  const slot = slotParam ? Number(slotParam) : undefined;
  const page = parseIntParam(searchParams.get("page"), 1, 1, 10_000);
  const pageSize = parseIntParam(searchParams.get("pageSize"), 20, 1, 100);

  const where: any = { orgId };
  if (Number.isFinite(slot)) where.slot = slot;

  const userWhere =
    q && q.length
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
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
            hashedPassword: true,
          },
        },
        orgRole: { select: { label: true, isActive: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((r) => {
    const u = r.user;
    const isInvited =
      typeof u.hashedPassword === "string" &&
      u.hashedPassword.startsWith("invited:");
    return {
      id: u.id,
      name: u.displayName || u.email,
      email: u.email,
      slot: r.slot,
      roleLabel: r.orgRole?.label ?? `Role ${r.slot}`,
      roleActive: r.orgRole?.isActive ?? false,
      isInvited,
    };
  });

  return NextResponse.json({ items, page, pageSize, total });
}

/** ------------------------------------------------------------------------
 * POST: create/add user; returns member + inviteUrl (if invited)
 * ---------------------------------------------------------------------- */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedOrgId = (searchParams.get("orgId") || "").trim() || null;

  const session = await getServerSession(authOptions);
  const actingUserId = (session?.user as any)?.id as string | undefined;
  if (!actingUserId) return unauthorized();

  const orgId = await resolveOrgForUser(requestedOrgId, actingUserId);
  if (!orgId) return badRequest("Missing or invalid orgId");

  const ok = await hasPermission(orgId, actingUserId, "settings:manage");
  if (!ok) return forbidden();

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
  if (!slot) slot = 6; // safe default
  if (!Number.isFinite(slot) || slot < 1 || slot > 10) {
    return badRequest("Invalid 'slot' (must be 1..10)");
  }

  // Find or create the user
  let targetUser = rawUserId
    ? await prisma.user.findUnique({
        where: { id: rawUserId },
        select: {
          id: true,
          email: true,
          displayName: true,
          hashedPassword: true,
        },
      })
    : await prisma.user.findFirst({
        where: { email: { equals: rawEmail, mode: "insensitive" } },
        select: {
          id: true,
          email: true,
          displayName: true,
          hashedPassword: true,
        },
      });

  if (!targetUser) {
    const placeholderHash = `invited:${randomBytes(48).toString("hex")}`;
    targetUser = await prisma.user.create({
      data: {
        email: rawEmail,
        displayName: displayName || null,
        hashedPassword: placeholderHash, // not a real password
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        hashedPassword: true,
      },
    });
  }

  // If already a member, return immediately (idempotent)
  const existing = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: targetUser.id, orgId } },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          hashedPassword: true,
        },
      },
      orgRole: { select: { label: true, isActive: true } },
    },
  });

  const origin = req.nextUrl.origin;
  const inviteUrlFor = (u: {
    id: string;
    email: string;
    hashedPassword: string | null;
  }) => {
    const isInvited =
      typeof u.hashedPassword === "string" &&
      u.hashedPassword.startsWith("invited:");
    if (!isInvited) return null;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 60 * 24 * 7; // 7 days
    const token = makeInviteToken(origin, {
      typ: "invite",
      orgId,
      userId: u.id,
      email: u.email,
      iat: now,
      exp,
    });
    return `${origin}/auth/invite/accept?token=${encodeURIComponent(token)}`;
  };

  if (existing) {
    const u = existing.user;
    const member = {
      id: u.id,
      name: u.displayName || u.email,
      email: u.email,
      slot: existing.slot,
      roleLabel: existing.orgRole?.label ?? `Role ${existing.slot}`,
      roleActive: existing.orgRole?.isActive ?? false,
      isInvited:
        typeof u.hashedPassword === "string" &&
        u.hashedPassword.startsWith("invited:"),
    };
    const inviteUrl = inviteUrlFor(u);
    return NextResponse.json({ member, inviteUrl }, { status: 200 });
  }

  // Create membership
  const created = await prisma.userRole.create({
    data: { orgId, userId: targetUser.id, slot },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          hashedPassword: true,
        },
      },
      orgRole: { select: { label: true, isActive: true } },
    },
  });

  const u = created.user;
  const member = {
    id: u.id,
    name: u.displayName || u.email,
    email: u.email,
    slot: created.slot,
    roleLabel: created.orgRole?.label ?? `Role ${created.slot}`,
    roleActive: created.orgRole?.isActive ?? false,
    isInvited:
      typeof u.hashedPassword === "string" &&
      u.hashedPassword.startsWith("invited:"),
  };
  const inviteUrl = inviteUrlFor(u);

  return NextResponse.json({ member, inviteUrl }, { status: 201 });
}
