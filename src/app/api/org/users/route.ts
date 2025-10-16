// src/app/api/org/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import { randomBytes, createHmac } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { error: string; code?: string };

function json400(msg: string, code?: string) {
  return NextResponse.json({ error: msg, code } as JsonErr, { status: 400 });
}
function json401(msg = "Unauthorized") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 401 });
}
function json403(msg = "Forbidden") {
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

/* -------------------------------------------------------------------------- */
/* Org / permission helpers                                                   */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* HS256 helpers (shared shape for invites)                                   */
/* -------------------------------------------------------------------------- */

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
  // Include both keys to be compatible with any historical checks.
  type: "invite";
  typ: "invite";
  orgId: string;
  userId: string;
  email: string;
  iat: number; // seconds
  exp: number; // seconds
};

function signInviteToken(payload: InvitePayload) {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Missing NEXTAUTH_SECRET/AUTH_SECRET for generating invite tokens"
    );
  }
  return signHS256({ alg: "HS256", typ: "JWT" }, payload, secret);
}

/* -------------------------------------------------------------------------- */
/* GET: list members                                                          */
/* -------------------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedOrgId = (searchParams.get("orgId") || "").trim() || null;

  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return json401();

  const orgId = await resolveOrgForUser(requestedOrgId, userId);
  if (!orgId) return json400("Missing or invalid orgId");

  // Allow read access for either settings:manage (admin) OR directory:view (Directory page)
  const okManage = await hasPermission(orgId, userId, "settings:manage");
  const okDirectory = await hasPermission(orgId, userId, "directory:view");
  if (!okManage && !okDirectory) return json403();

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

/* -------------------------------------------------------------------------- */
/* POST: add user by email/userId; returns member + inviteUrl (if invited)    */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedOrgId = (searchParams.get("orgId") || "").trim() || null;

  const session = await getServerSession(authOptions);
  const actingUserId = (session?.user as any)?.id as string | undefined;
  if (!actingUserId) return json401();

  const orgId = await resolveOrgForUser(requestedOrgId, actingUserId);
  if (!orgId) return json400("Missing or invalid orgId");

  const ok = await hasPermission(orgId, actingUserId, "settings:manage");
  if (!ok) return json403();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json400("Invalid JSON body");
  }

  const rawEmail = (body?.email ?? "").trim();
  const rawUserId = (body?.userId ?? "").trim();
  const displayName =
    typeof body?.name === "string" ? body.name.trim() : undefined;

  if ((!rawEmail && !rawUserId) || (rawEmail && rawUserId)) {
    return json400("Provide exactly one of 'email' or 'userId'");
  }

  // Resolve slot
  let slot: number | undefined = Number.isFinite(body?.slot)
    ? Number(body.slot)
    : undefined;
  if (!slot && typeof body?.orgRoleKey === "string") {
    const m = /^role(10|[1-9])$/i.exec(body.orgRoleKey);
    if (m) slot = Number(m[1]);
  }
  if (!slot) slot = 6;
  if (!Number.isFinite(slot) || slot < 1 || slot > 10) {
    return json400("Invalid 'slot' (must be 1..10)");
  }

  // Find or create the user
  let user = rawUserId
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

  // Rule: DO NOT invite existing users by email (any org)
  if (rawEmail && user) {
    const isInvited =
      typeof user.hashedPassword === "string" &&
      user.hashedPassword.startsWith("invited:");
    if (!isInvited) {
      return NextResponse.json(
        { error: "User already exists", code: "user_exists" } as JsonErr,
        { status: 409 }
      );
    }
  }

  // Create placeholder record if truly new
  if (!user) {
    const placeholderHash = `invited:${randomBytes(48).toString("hex")}`;
    user = await prisma.user.create({
      data: {
        email: rawEmail,
        displayName: displayName || null,
        hashedPassword: placeholderHash,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        hashedPassword: true,
      },
    });
  }

  // Idempotent membership
  const existing = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
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
    const token = signInviteToken({
      type: "invite",
      typ: "invite",
      orgId,
      userId: u.id,
      email: u.email,
      iat: now,
      exp,
    });

    return `${req.nextUrl.origin}/auth/invite/accept?token=${encodeURIComponent(
      token
    )}`;
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
    data: { orgId, userId: user.id, slot },
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
